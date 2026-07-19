import type { Server } from "socket.io";
import type { openDatabase } from "./db/database.js";
import type { CreateTaskInput, ProxyRouteDefinition, TaskRecord, WorkflowDefinition } from "./types.js";

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_AGENT_PROFILE_COUNT = 3;
const HOUR_MS = 3_600_000;
const QUICK_STAGGER_MIN_MS = 10_000;
const QUICK_STAGGER_MAX_MS = 45_000;
const SLOT_RANDOM_MIN = 0.12;
const SLOT_RANDOM_MAX = 0.88;

type Store = ReturnType<typeof openDatabase>;

export interface ScheduleInput {
  targetUrl: string;
  targetVotes: number;
  totalHours: number;
  locales: string[];
  regions: string[];
  maxParallelThreads: number;
  /** Hour of day (0-23) when dispatches may start. Default: 0 */
  activeHoursStart?: number;
  /** Hour of day (0-23, exclusive) when dispatches must stop. Default: 24 */
  activeHoursEnd?: number;
  /** Per-task workflow click selectors. */
  workflow?: WorkflowDefinition;
  /** Custom proxy pool with individual usage limits. */
  proxyRoutes?: ProxyRouteDefinition[];
}

export function createDispatchScheduler(store: Store, io: Server) {
  const timers = new Map<string, NodeJS.Timeout>();

  function scheduleBatch(input: ScheduleInput) {
    const activeStart = input.activeHoursStart ?? 0;
    const activeEnd = input.activeHoursEnd ?? 24;
    const proxyPool = input.proxyRoutes ?? parseEnvProxyRoutes();

    // Build the schedule: assign each dispatch a time within active windows
    const now = Date.now();
    const scheduledTimes = buildDiurnalSchedule(now, input.targetVotes, input.totalHours, activeStart, activeEnd);

    // Assign proxies respecting per-proxy maxUsages limits
    const proxyAssignments = assignProxies(proxyPool, input.targetVotes, store);

    const tasks = store.createTasks(
      Array.from({ length: input.targetVotes }, (_, dispatchIndex) => {
        const scheduledAt = new Date(scheduledTimes[dispatchIndex]).toISOString();
        const assignedProxy = proxyAssignments[dispatchIndex] ?? null;
        return buildDispatchTask(input, dispatchIndex, scheduledAt, assignedProxy);
      })
    );

    for (const task of tasks) {
      armDispatchTimer(task);
      io.emit("task:created", task);
    }

    const baseDelayMs =
      input.targetVotes <= 1 ? 0 : (scheduledTimes[scheduledTimes.length - 1] - scheduledTimes[0]) / (input.targetVotes - 1);

    return {
      tasks,
      schedule: {
        targetVotes: input.targetVotes,
        totalHours: input.totalHours,
        activeHoursStart: activeStart,
        activeHoursEnd: activeEnd,
        baseDelayMs: Math.round(baseDelayMs)
      }
    };
  }

  function restorePendingDispatches() {
    for (const task of store.listPendingDispatches()) {
      armDispatchTimer(task);
    }
  }

  function armDispatchTimer(task: TaskRecord) {
    if (!task.scheduledAt || task.status !== "pending") {
      return;
    }

    const delayMs = Math.max(0, new Date(task.scheduledAt).getTime() - Date.now());
    const timeout = setTimeout(() => {
      timers.delete(task.id);
      if (delayMs > MAX_TIMEOUT_MS) {
        armDispatchTimer(task);
        return;
      }

      const promoted = store.promotePendingTask(task.id);
      if (promoted) {
        io.emit("task:updated", promoted);
      }
    }, Math.min(delayMs, MAX_TIMEOUT_MS));

    timers.set(task.id, timeout);
  }

  return { scheduleBatch, restorePendingDispatches };
}

/**
 * Builds a randomized, even schedule across the requested wall-clock period.
 * The scheduler first finds all allowed active-hour intervals, then samples one
 * randomized timestamp per evenly sized slot. That keeps work spread across the
 * full period without collapsing inactive-hour tasks onto the next window start.
 */
function buildDiurnalSchedule(
  nowMs: number,
  count: number,
  totalHours: number,
  activeStart: number,
  activeEnd: number
): number[] {
  if (count <= 0) return [];

  const scheduleStart = nextActiveTimestamp(nowMs, activeStart, activeEnd);
  if (count === 1 || totalHours <= 0) {
    return buildQuickStaggeredSchedule(scheduleStart, count, activeStart, activeEnd);
  }

  const scheduleEnd = scheduleStart + totalHours * HOUR_MS;
  const intervals = buildActiveIntervals(scheduleStart, scheduleEnd, activeStart, activeEnd);
  const availableMs = intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0);

  if (availableMs <= 0) {
    return buildQuickStaggeredSchedule(scheduleStart, count, activeStart, activeEnd);
  }

  const slotMs = availableMs / count;
  const offsets = Array.from({ length: count }, (_, i) => {
    const slotStart = i * slotMs;
    const randomPoint = SLOT_RANDOM_MIN + Math.random() * (SLOT_RANDOM_MAX - SLOT_RANDOM_MIN);
    return Math.floor(slotStart + slotMs * randomPoint);
  });

  return offsets.map((offsetMs) => activeOffsetToTimestamp(intervals, offsetMs)).sort((a, b) => a - b);
}

function buildQuickStaggeredSchedule(
  startMs: number,
  count: number,
  activeStart: number,
  activeEnd: number
) {
  const times: number[] = [];
  let cursor = startMs;

  for (let i = 0; i < count; i++) {
    cursor = nextActiveTimestamp(cursor, activeStart, activeEnd);
    times.push(cursor);
    cursor += randomInt(QUICK_STAGGER_MIN_MS, QUICK_STAGGER_MAX_MS);
  }

  return times;
}

function buildActiveIntervals(
  startMs: number,
  endMs: number,
  activeStart: number,
  activeEnd: number
) {
  const intervals: Array<{ start: number; end: number }> = [];
  let cursor = startMs;
  const maxIterations = Math.max(2, Math.ceil((endMs - startMs) / HOUR_MS) + 48);

  for (let i = 0; i < maxIterations && cursor < endMs; i++) {
    const intervalStart = nextActiveTimestamp(cursor, activeStart, activeEnd);
    if (intervalStart >= endMs) break;

    const intervalEnd = Math.min(activeWindowEnd(intervalStart, activeStart, activeEnd), endMs);
    if (intervalEnd > intervalStart) {
      intervals.push({ start: intervalStart, end: intervalEnd });
    }

    cursor = Math.max(intervalEnd + 1, cursor + 1);
  }

  return intervals;
}

function activeOffsetToTimestamp(intervals: Array<{ start: number; end: number }>, offsetMs: number) {
  let remaining = offsetMs;

  for (const interval of intervals) {
    const duration = interval.end - interval.start;
    if (remaining < duration) {
      return interval.start + remaining;
    }
    remaining -= duration;
  }

  return intervals[intervals.length - 1].end - 1;
}

function nextActiveTimestamp(timestampMs: number, activeStart: number, activeEnd: number): number {
  if (isAlwaysActive(activeStart, activeEnd) || isWithinActiveWindow(timestampMs, activeStart, activeEnd)) {
    return timestampMs;
  }

  const t = new Date(timestampMs);
  const hour = localDecimalHour(t);

  if (activeStart < activeEnd) {
    if (hour < activeStart) {
      return localHourTimestamp(t, activeStart);
    }
    const tomorrow = new Date(t);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return localHourTimestamp(tomorrow, activeStart);
  }

  // Overnight window, for example 22 -> 6. If the time is outside the window,
  // it is between end and start, so today's start is next.
  return localHourTimestamp(t, activeStart);
}

function activeWindowEnd(timestampMs: number, activeStart: number, activeEnd: number): number {
  if (isAlwaysActive(activeStart, activeEnd)) {
    return Number.POSITIVE_INFINITY;
  }

  const t = new Date(timestampMs);
  const hour = localDecimalHour(t);

  if (activeStart < activeEnd) {
    return localHourTimestamp(t, activeEnd);
  }

  if (hour >= activeStart) {
    const tomorrow = new Date(t);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return localHourTimestamp(tomorrow, activeEnd);
  }

  return localHourTimestamp(t, activeEnd);
}

function isWithinActiveWindow(timestampMs: number, activeStart: number, activeEnd: number) {
  if (isAlwaysActive(activeStart, activeEnd)) return true;

  const hour = localDecimalHour(new Date(timestampMs));
  return activeStart < activeEnd
    ? hour >= activeStart && hour < activeEnd
    : hour >= activeStart || hour < activeEnd;
}

function isAlwaysActive(activeStart: number, activeEnd: number) {
  return activeStart === activeEnd || (activeStart === 0 && activeEnd === 24);
}

function localDecimalHour(date: Date) {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 + date.getMilliseconds() / HOUR_MS;
}

function localHourTimestamp(base: Date, hour: number) {
  const t = new Date(base);
  t.setMinutes(0, 0, 0);
  if (hour === 24) {
    t.setHours(0);
    t.setDate(t.getDate() + 1);
    return t.getTime();
  }
  t.setHours(hour);
  return t.getTime();
}

/**
 * Assigns proxy routes to each dispatch index while respecting per-proxy maxUsages.
 * Iterates the pool in round-robin; skips entries that have reached their limit.
 */
function assignProxies(
  pool: ProxyRouteDefinition[],
  count: number,
  store: Store
): Array<ProxyRouteDefinition | null> {
  if (pool.length === 0) return Array(count).fill(null);

  // Build a live usage map including what is already in the DB
  const usageMap = new Map<string, number>();
  for (const proxy of pool) {
    usageMap.set(proxy.id, store.getProxyUsageCount(proxy.id));
  }

  const result: Array<ProxyRouteDefinition | null> = [];

  for (let i = 0; i < count; i++) {
    // Walk the pool until we find one under its limit (or exhaust all)
    let assigned: ProxyRouteDefinition | null = null;
    for (let attempt = 0; attempt < pool.length; attempt++) {
      const candidate = pool[(i + attempt) % pool.length];
      const currentUsage = usageMap.get(candidate.id) ?? 0;
      const limit = candidate.maxUsages ?? Infinity;
      if (currentUsage < limit) {
        usageMap.set(candidate.id, currentUsage + 1);
        assigned = candidate;
        break;
      }
    }
    result.push(assigned);
  }

  return result;
}

function buildDispatchTask(
  input: ScheduleInput,
  dispatchIndex: number,
  scheduledAt: string,
  proxy: ProxyRouteDefinition | null
): CreateTaskInput {
  return {
    targetUrl: input.targetUrl,
    totalExecutions: 1,
    distributionHours: 0,
    locales: input.locales,
    regions: input.regions,
    maxParallelThreads: 1,
    status: "pending",
    scheduledAt,
    dispatchIndex,
    agentProfileIndex: dispatchIndex % DEFAULT_AGENT_PROFILE_COUNT,
    proxyRouteId: proxy?.id ?? null,
    workflow: input.workflow ?? null,
    proxy: proxy ?? null
  };
}

function parseEnvProxyRoutes(): ProxyRouteDefinition[] {
  const value = process.env.PROXY_ROUTES_JSON;
  if (!value) return [];
  try {
    const routes = JSON.parse(value) as ProxyRouteDefinition[];
    return Array.isArray(routes) ? routes.filter((r) => r.id) : [];
  } catch {
    return [];
  }
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}
