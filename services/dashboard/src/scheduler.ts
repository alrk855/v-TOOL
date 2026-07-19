import type { Server } from "socket.io";
import type { openDatabase } from "./db/database.js";
import type { CreateTaskInput, ProxyRouteDefinition, TaskRecord, WorkflowDefinition } from "./types.js";

const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_AGENT_PROFILE_COUNT = 3;

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
 * Builds a diurnal-shaped list of scheduled timestamps.
 * Execution density follows a cosine wave peaking at mid-afternoon (14:00)
 * within the configured active-hours window. Any slot that falls outside the
 * window is rolled into the next active day automatically.
 */
function buildDiurnalSchedule(
  nowMs: number,
  count: number,
  totalHours: number,
  activeStart: number,
  activeEnd: number
): number[] {
  if (count <= 0) return [];

  const totalMs = totalHours * 3_600_000;
  const scheduleStart = clampToActiveWindow(nowMs, activeStart, activeEnd);
  const spacingMs = count <= 1 ? 0 : totalMs / (count - 1);

  // Generate a gentle diurnal curve by nudging slots around their linear position.
  const weights = Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const cosVal = Math.cos((t - 0.6) * Math.PI * 1.2);
    return 0.3 + 0.7 * Math.max(0, cosVal);
  });
  const averageWeight = weights.reduce((a, b) => a + b, 0) / weights.length;

  const times: number[] = [];

  for (let i = 0; i < count; i++) {
    const linearOffsetMs = count === 1 ? 0 : i * spacingMs;
    const densityNudgeMs = spacingMs > 0 ? (averageWeight - weights[i]) * spacingMs * 0.25 : 0;
    const jitterMs = spacingMs > 0 && i > 0 && i < count - 1 ? randomJitterMs(spacingMs * 0.2) : 0;
    const offsetMs = clamp(linearOffsetMs + densityNudgeMs + jitterMs, 0, totalMs);

    times.push(clampToActiveWindow(scheduleStart + offsetMs, activeStart, activeEnd));
  }

  return times.sort((a, b) => a - b);
}

/** Ensures a timestamp falls within the active hours window; rolls to next day if outside. */
function clampToActiveWindow(
  timestampMs: number,
  activeStart: number,
  activeEnd: number
): number {
  let t = new Date(timestampMs);
  for (let day = 0; day < 8; day++) {
    const h = t.getHours() + t.getMinutes() / 60;
    if (h >= activeStart && h < activeEnd) {
      return t.getTime();
    }
    // Push to start of next active window
    const next = new Date(t);
    if (h >= activeEnd) {
      // Already past today's window – advance to tomorrow's start
      next.setDate(next.getDate() + 1);
    }
    next.setHours(activeStart, randomInt(0, 15), randomInt(0, 59), 0);
    t = next;
  }
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

function randomJitterMs(base: number): number {
  // ±20% of base interval
  const window = base * 0.2;
  return Math.floor(-window + Math.random() * window * 2);
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
