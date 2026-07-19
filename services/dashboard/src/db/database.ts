import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CreateTaskInput, ExecutionLogInput, TaskRecord, TaskStatus } from "../types.js";

const migrationsDir = path.resolve("src/db/migrations");

export function openDatabase(databasePath: string) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const migration = fs.readFileSync(path.join(migrationsDir, "001_init.sql"), "utf8");
  db.exec(migration);
  ensureTaskSchema(db);

  return {
    createTask(input: CreateTaskInput): TaskRecord {
      const now = new Date().toISOString();
      const id = randomUUID();
      const status = input.status ?? "queued";

      db.prepare(`
        INSERT INTO tasks (
          id, target_url, total_executions, distribution_hours, locales_json, regions_json,
          max_parallel_threads, status, scheduled_at, dispatch_index, agent_profile_index,
          proxy_route_id, workflow_json, proxy_json, created_at, updated_at
        )
        VALUES (@id, @targetUrl, @totalExecutions, @distributionHours, @localesJson, @regionsJson,
          @maxParallelThreads, @status, @scheduledAt, @dispatchIndex, @agentProfileIndex,
          @proxyRouteId, @workflowJson, @proxyJson, @now, @now)
      `).run({
        id,
        targetUrl: input.targetUrl,
        totalExecutions: input.totalExecutions,
        distributionHours: input.distributionHours,
        localesJson: JSON.stringify(input.locales),
        regionsJson: JSON.stringify(input.regions),
        maxParallelThreads: input.maxParallelThreads,
        status,
        scheduledAt: input.scheduledAt ?? null,
        dispatchIndex: input.dispatchIndex ?? null,
        agentProfileIndex: input.agentProfileIndex ?? null,
        proxyRouteId: input.proxyRouteId ?? null,
        workflowJson: JSON.stringify(input.workflow ?? {}),
        proxyJson: input.proxy ? JSON.stringify(input.proxy) : null,
        now
      });

      return this.getTask(id)!;
    },

    createTasks(inputs: CreateTaskInput[]): TaskRecord[] {
      db.exec("BEGIN");
      try {
        const results = inputs.map((item) => this.createTask(item));
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    resetRunningTasks() {
      const now = new Date().toISOString();
      db.prepare("UPDATE tasks SET status = 'queued', updated_at = ? WHERE status = 'running'").run(now);
    },

    getTask(id: string): TaskRecord | null {
      const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as unknown as TaskRow | undefined;
      return row ? mapTask(row) : null;
    },

    listTasks(limit = 500): TaskRecord[] {
      const rows = db
        .prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?")
        .all(limit) as unknown as TaskRow[];
      return rows.map(mapTask);
    },

    listPendingDispatches(): TaskRecord[] {
      const rows = db
        .prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY scheduled_at ASC")
        .all() as unknown as TaskRow[];
      return rows.map(mapTask);
    },

    claimNextTask(): TaskRecord | null {
      const row = db
        .prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
        .get() as unknown as TaskRow | undefined;

      if (!row) {
        return null;
      }

      const now = new Date().toISOString();
      db.prepare("UPDATE tasks SET status = 'running', started_at = @now, updated_at = @now WHERE id = @id").run({
        now,
        id: row.id
      });

      return this.getTask(row.id);
    },

    updateTaskStatus(id: string, status: TaskStatus): TaskRecord | null {
      const now = new Date().toISOString();
      const completedAt = status === "completed" || status === "failed" || status === "cancelled" ? now : null;
      db.prepare("UPDATE tasks SET status = @status, completed_at = COALESCE(@completedAt, completed_at), updated_at = @now WHERE id = @id").run({
        status,
        completedAt,
        now,
        id
      });
      return this.getTask(id);
    },

    cancelTasks(statuses: TaskStatus[] = ["pending", "queued"]): TaskRecord[] {
      if (statuses.length === 0) return [];
      const placeholders = statuses.map((_, index) => `@status${index}`).join(", ");
      const params = Object.fromEntries(statuses.map((status, index) => [`status${index}`, status]));
      const rows = db
        .prepare(`SELECT id FROM tasks WHERE status IN (${placeholders}) ORDER BY created_at DESC`)
        .all(params) as Array<{ id: string }>;
      if (rows.length === 0) return [];

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        const stmt = db.prepare("UPDATE tasks SET status = 'cancelled', completed_at = @now, updated_at = @now WHERE id = @id");
        for (const row of rows) {
          stmt.run({ id: row.id, now });
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      return rows.map((row) => this.getTask(row.id)).filter((task): task is TaskRecord => Boolean(task));
    },

    promotePendingTask(id: string): TaskRecord | null {
      const now = new Date().toISOString();
      db.prepare("UPDATE tasks SET status = 'queued', updated_at = @now WHERE id = @id AND status = 'pending'").run({
        now,
        id
      });
      return this.getTask(id);
    },

    insertExecutionLog(input: ExecutionLogInput) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO execution_logs (
          task_id, thread_id, status_code, message, user_agent, locale, region, timezone_id,
          viewport_width, viewport_height, device_scale_factor, proxy_route_id, duration_ms,
          metadata_json, created_at
        )
        VALUES (
          @taskId, @threadId, @statusCode, @message, @userAgent, @locale, @region, @timezoneId,
          @viewportWidth, @viewportHeight, @deviceScaleFactor, @proxyRouteId, @durationMs,
          @metadataJson, @createdAt
        )
      `).run({
        taskId: input.taskId,
        threadId: input.threadId,
        statusCode: input.statusCode,
        message: input.message ?? null,
        userAgent: input.userAgent,
        locale: input.locale,
        region: input.region,
        timezoneId: input.timezoneId ?? null,
        viewportWidth: input.viewportWidth,
        viewportHeight: input.viewportHeight,
        deviceScaleFactor: input.deviceScaleFactor,
        proxyRouteId: input.proxyRouteId,
        durationMs: input.durationMs ?? null,
        metadataJson: JSON.stringify(input.metadata ?? {}),
        createdAt: now
      });

      if (input.statusCode === "completed") {
        db.prepare("UPDATE tasks SET completed_executions = completed_executions + 1, updated_at = @now WHERE id = @id").run({
          now,
          id: input.taskId
        });
      }

      if (input.statusCode === "failed") {
        db.prepare("UPDATE tasks SET failed_executions = failed_executions + 1, updated_at = @now WHERE id = @id").run({
          now,
          id: input.taskId
        });
      }

      return this.getTask(input.taskId);
    },

    listExecutionLogs(taskId?: string, limit = 100) {
      const rows = taskId
        ? db
            .prepare("SELECT * FROM execution_logs WHERE task_id = @taskId ORDER BY created_at DESC LIMIT @limit")
            .all({ taskId, limit })
        : db.prepare("SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT @limit").all({ limit });
      return rows.map(mapExecutionLog);
    },

    getProxyUsageCount(proxyRouteId: string): number {
      const row = db
        .prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE proxy_route_id = @proxyRouteId AND status NOT IN ('cancelled')")
        .get({ proxyRouteId }) as unknown as { cnt: number };
      return row.cnt;
    },

    stats() {
      const taskCounts = db
        .prepare("SELECT status, COUNT(*) AS count FROM tasks GROUP BY status")
        .all() as Array<{ status: TaskStatus; count: number }>;
      const executionCounts = db
        .prepare("SELECT status_code AS statusCode, COUNT(*) AS count FROM execution_logs GROUP BY status_code")
        .all() as Array<{ statusCode: string; count: number }>;
      const proxyUsage = db
        .prepare(
          "SELECT proxy_route_id AS proxyRouteId, COUNT(*) AS usages FROM tasks WHERE proxy_route_id IS NOT NULL AND status NOT IN ('cancelled') GROUP BY proxy_route_id"
        )
        .all() as Array<{ proxyRouteId: string; usages: number }>;
      return { taskCounts, executionCounts, proxyUsage, summary: buildExecutionSummary(db) };
    }
  };
}

function ensureTaskSchema(db: DatabaseSync) {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  const requiredColumns = [
    ["scheduled_at", "TEXT"],
    ["dispatch_index", "INTEGER"],
    ["agent_profile_index", "INTEGER"],
    ["proxy_route_id", "TEXT"],
    ["workflow_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["proxy_json", "TEXT"]
  ] as const;

  for (const [name, definition] of requiredColumns) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`);
    }
  }
}

function buildExecutionSummary(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT task_id, thread_id, status_code, message, duration_ms, proxy_route_id, metadata_json, created_at
       FROM execution_logs
       ORDER BY created_at DESC`
    )
    .all() as Array<{
      task_id: string;
      thread_id: string;
      status_code: string;
      message: string | null;
      duration_ms: number | null;
      proxy_route_id: string;
      metadata_json: string;
      created_at: string;
    }>;

  const summary = {
    totalRuns: rows.length,
    completedRuns: 0,
    failedRuns: 0,
    avgDurationMs: 0,
    workflow: {
      entry: createStageStats(),
      selection: createStageStats(),
      commit: createStageStats()
    },
    recentFailures: [] as Array<{
      taskId: string;
      threadId: string;
      message: string;
      proxyRouteId: string;
      createdAt: string;
    }>
  };

  let durationTotal = 0;
  let durationCount = 0;

  for (const row of rows) {
    if (row.status_code === "completed") summary.completedRuns++;
    if (row.status_code === "failed") summary.failedRuns++;

    if (typeof row.duration_ms === "number") {
      durationTotal += row.duration_ms;
      durationCount++;
    }

    const metadata = parseMetadata(row.metadata_json);
    const workflow = metadata.workflow as Record<string, unknown> | undefined;
    recordStage(summary.workflow.entry, workflow?.entry);
    recordStage(summary.workflow.selection, workflow?.selection);
    recordStage(summary.workflow.commit, workflow?.commit);

    if (row.status_code === "failed" && summary.recentFailures.length < 10) {
      summary.recentFailures.push({
        taskId: row.task_id,
        threadId: row.thread_id,
        message: row.message ?? "No failure message recorded",
        proxyRouteId: row.proxy_route_id,
        createdAt: row.created_at
      });
    }
  }

  summary.avgDurationMs = durationCount > 0 ? Math.round(durationTotal / durationCount) : 0;
  return summary;
}

function createStageStats() {
  return { matched: 0, failed: 0, skipped: 0, total: 0 };
}

function recordStage(stageStats: ReturnType<typeof createStageStats>, rawStage: unknown) {
  if (!rawStage || typeof rawStage !== "object") return;
  const stage = rawStage as { matched?: unknown; strategy?: unknown };
  stageStats.total++;
  if (stage.strategy === "skipped") {
    stageStats.skipped++;
    return;
  }
  if (stage.matched === true) {
    stageStats.matched++;
    return;
  }
  stageStats.failed++;
}

function parseMetadata(value: string) {
  try {
    return value ? JSON.parse(value) as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

interface TaskRow {
  id: string;
  target_url: string;
  total_executions: number;
  distribution_hours: number;
  locales_json: string;
  regions_json: string;
  max_parallel_threads: number;
  status: TaskStatus;
  completed_executions: number;
  failed_executions: number;
  scheduled_at: string | null;
  dispatch_index: number | null;
  agent_profile_index: number | null;
  proxy_route_id: string | null;
  workflow_json: string;
  proxy_json: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    targetUrl: row.target_url,
    totalExecutions: row.total_executions,
    distributionHours: row.distribution_hours,
    locales: JSON.parse(row.locales_json),
    regions: JSON.parse(row.regions_json),
    maxParallelThreads: row.max_parallel_threads,
    status: row.status,
    completedExecutions: row.completed_executions,
    failedExecutions: row.failed_executions,
    scheduledAt: row.scheduled_at,
    dispatchIndex: row.dispatch_index,
    agentProfileIndex: row.agent_profile_index,
    proxyRouteId: row.proxy_route_id,
    workflow: row.workflow_json ? JSON.parse(row.workflow_json) : null,
    proxy: row.proxy_json ? JSON.parse(row.proxy_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

function mapExecutionLog(row: any) {
  return {
    id: row.id,
    taskId: row.task_id,
    threadId: row.thread_id,
    statusCode: row.status_code,
    message: row.message,
    userAgent: row.user_agent,
    locale: row.locale,
    region: row.region,
    timezoneId: row.timezone_id,
    viewportWidth: row.viewport_width,
    viewportHeight: row.viewport_height,
    deviceScaleFactor: row.device_scale_factor,
    proxyRouteId: row.proxy_route_id,
    durationMs: row.duration_ms,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    createdAt: row.created_at
  };
}
