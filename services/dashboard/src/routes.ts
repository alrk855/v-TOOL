import express from "express";
import { z } from "zod";
import type { Server } from "socket.io";
import { exec } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { openDatabase } from "./db/database.js";
import type { createDispatchScheduler } from "./scheduler.js";

const proxyRouteSchema = z.object({
  id: z.string().min(1),
  server: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  maxUsages: z.coerce.number().int().min(1).optional()
});

const workflowSchema = z.object({
  entrySelector: z.string().optional(),
  targetAssetSelector: z.string().optional(),
  selectionStateSelector: z.string().optional(),
  finalActionSelector: z.string().optional(),
  finalActionTexts: z.union([z.string(), z.array(z.string())]).transform(toList).optional()
});

const createTaskSchema = z.object({
  targetUrl: z.string().url(),
  totalExecutions: z.coerce.number().int().min(1).max(100000).optional(),
  targetVotes: z.coerce.number().int().min(1).max(100000).optional(),
  distributionHours: z.coerce.number().min(0).max(720).optional(),
  totalHours: z.coerce.number().min(0).max(720).optional(),
  locales: z.union([z.string(), z.array(z.string())]).transform(toList),
  regions: z.union([z.string(), z.array(z.string())]).transform(toList),
  maxParallelThreads: z.coerce.number().int().min(1).max(256),
  activeHoursStart: z.coerce.number().int().min(0).max(23).optional(),
  activeHoursEnd: z.coerce.number().int().min(1).max(24).optional(),
  workflow: workflowSchema.optional(),
  proxyRoutes: z.array(proxyRouteSchema).optional()
}).transform((input) => ({
  targetUrl: input.targetUrl,
  targetVotes: input.targetVotes ?? input.totalExecutions ?? 1,
  totalHours: input.totalHours ?? input.distributionHours ?? 0,
  locales: input.locales,
  regions: input.regions,
  maxParallelThreads: input.maxParallelThreads,
  activeHoursStart: input.activeHoursStart,
  activeHoursEnd: input.activeHoursEnd,
  workflow: input.workflow,
  proxyRoutes: input.proxyRoutes
}));

const logSchema = z.object({
  taskId: z.string().uuid(),
  threadId: z.string(),
  statusCode: z.string(),
  message: z.string().optional(),
  userAgent: z.string(),
  locale: z.string(),
  region: z.string(),
  timezoneId: z.string().optional(),
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
  deviceScaleFactor: z.number().positive(),
  proxyRouteId: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional()
});

type Store = ReturnType<typeof openDatabase>;
type Scheduler = ReturnType<typeof createDispatchScheduler>;

export function createRouter(store: Store, io: Server, scheduler: Scheduler) {
  const router = express.Router();

  router.get("/diagnostics/audit", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Diagnostics Audit</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }
    body { margin: 0; padding: 32px; background: linear-gradient(180deg, #eef3f8 0%, #ffffff 100%); color: #18212f; }
    main { max-width: 960px; margin: 0 auto; display: grid; gap: 16px; }
    .card { background: rgba(255,255,255,0.92); border: 1px solid #d7e0ea; border-radius: 16px; padding: 20px 24px; box-shadow: 0 10px 40px rgba(24, 33, 47, 0.08); }
    h1 { margin: 0 0 4px; font-size: 28px; }
    p { margin: 0; color: #516173; }
    dl { display: grid; grid-template-columns: 220px 1fr; gap: 10px 16px; margin: 18px 0 0; }
    dt { font-weight: 700; }
    dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-word; }
    .status { font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #6b7c91; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <div class="status">Internal rendering diagnostics</div>
      <h1>Audit Snapshot</h1>
      <p>Local-only telemetry view for browser property inspection.</p>
      <dl>
        <dt>navigator.webdriver</dt><dd id="webdriver-value">pending</dd>
        <dt>canvas hash</dt><dd id="canvas-value">pending</dd>
        <dt>webgl vendor</dt><dd id="webgl-vendor">pending</dd>
        <dt>webgl renderer</dt><dd id="webgl-renderer">pending</dd>
      </dl>
    </section>
  </main>
  <script>
    (() => {
      const webdriverValue = String(navigator.webdriver);

      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const context2d = canvas.getContext('2d');
      if (context2d) {
        context2d.fillStyle = '#172033';
        context2d.fillRect(0, 0, canvas.width, canvas.height);
        context2d.fillStyle = '#f5f7fb';
        context2d.font = '18px Arial';
        context2d.fillText('Audit', 8, 22);
      }
      const canvasValue = canvas.toDataURL('image/png');

      const glCanvas = document.createElement('canvas');
      const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl') || glCanvas.getContext('webgl2');
      const debugInfo = gl && gl.getExtension ? gl.getExtension('WEBGL_debug_renderer_info') : null;
      const webglVendor = gl && debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : 'unavailable';
      const webglRenderer = gl && debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : 'unavailable';

      window.__auditSnapshot = {
        webdriverValue,
        canvasValue,
        webglVendor,
        webglRenderer
      };

      document.getElementById('webdriver-value').textContent = webdriverValue;
      document.getElementById('canvas-value').textContent = canvasValue;
      document.getElementById('webgl-vendor').textContent = webglVendor;
      document.getElementById('webgl-renderer').textContent = webglRenderer;
    })();
  </script>
</body>
</html>`);
  });

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.post("/api/chrome/launch", (_req, res) => {
    const tempDir = path.join(os.tmpdir(), "dplt-chrome-profile");
    const args = `--remote-debugging-port=9222 --user-data-dir="${tempDir}" --no-first-run --no-default-browser-check`;
    exec(`start chrome ${args}`, (err) => {
      if (err) {
        // Fallback to absolute paths if "start chrome" is not recognized
        exec(`"%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" ${args}`, (err2) => {
          if (err2) {
            exec(`"%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" ${args}`, (err3) => {
              if (err3) {
                res.status(500).json({ error: "Could not launch Chrome. Ensure Chrome is installed." });
                return;
              }
              res.json({ ok: true });
            });
            return;
          }
          res.json({ ok: true });
        });
        return;
      }
      res.json({ ok: true });
    });
  });

  router.get("/api/tasks", (_req, res) => {
    res.json({ tasks: store.listTasks() });
  });

  router.post("/api/tasks", (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const batch = scheduler.scheduleBatch(parsed.data);
    res.status(201).json({
      tasks: batch.tasks,
      schedule: batch.schedule
    });
  });

  router.post("/api/runner/claim", (_req, res) => {
    const task = store.claimNextTask();
    if (!task) {
      res.status(204).send();
      return;
    }

    io.emit("task:updated", task);
    res.json({ task });
  });

  router.post("/api/tasks/:id/status", (req, res) => {
    const status = z.enum(["pending", "queued", "running", "completed", "failed", "cancelled"]).safeParse(req.body.status);
    if (!status.success) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const task = store.updateTaskStatus(req.params.id, status.data);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    io.emit("task:updated", task);
    res.json({ task });
  });

  router.post("/api/tasks/:id/postpone", (req, res) => {
    const parsed = z.object({
      scheduledAt: z.string().optional(),
      delayMinutes: z.coerce.number().optional()
    }).safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    let targetTime: string;
    if (parsed.data.scheduledAt) {
      targetTime = new Date(parsed.data.scheduledAt).toISOString();
    } else if (typeof parsed.data.delayMinutes === "number") {
      targetTime = new Date(Date.now() + parsed.data.delayMinutes * 60_000).toISOString();
    } else {
      targetTime = new Date(Date.now() + 15 * 60_000).toISOString(); // Default +15 mins
    }

    const task = store.postponeTask(req.params.id, targetTime, "pending");
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    io.emit("task:updated", task);
    res.json({ task });
  });

  router.post("/api/tasks/:id/requeue", (req, res) => {
    const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt).toISOString() : new Date().toISOString();
    const task = store.requeueTask(req.params.id, scheduledAt);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    io.emit("task:updated", task);
    res.json({ task });
  });

  router.delete("/api/tasks/:id", (req, res) => {
    const deleted = store.deleteTask(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    io.emit("task:deleted", { id: req.params.id });
    res.json({ ok: true, id: req.params.id });
  });

  router.post("/api/tasks/clear-cancelled", (_req, res) => {
    const count = store.deleteCancelledTasks();
    io.emit("tasks:purged", { count, status: "cancelled" });
    res.json({ cleared: count });
  });

  router.post("/api/tasks/cancel", (req, res) => {
    const parsed = z
      .object({
        statuses: z.array(z.enum(["pending", "queued"])).optional()
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const tasks = store.cancelTasks(parsed.data.statuses);
    for (const task of tasks) {
      io.emit("task:updated", task);
    }
    res.json({ cancelled: tasks.length, tasks });
  });

  router.post("/api/execution-logs", (req, res) => {
    const parsed = logSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const task = store.insertExecutionLog(parsed.data);
    const payload = { log: parsed.data, task };
    io.emit("execution:logged", payload);
    if (task) {
      io.emit("task:updated", task);
    }
    res.status(201).json(payload);
  });
  router.get("/api/execution-logs", (req, res) => {
    const taskId = typeof req.query.taskId === "string" ? req.query.taskId : undefined;
    res.json({ logs: store.listExecutionLogs(taskId) });
  });

  router.get("/api/execution-logs/export", (req, res) => {
    const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "json";
    const taskId = typeof req.query.taskId === "string" ? req.query.taskId : undefined;
    const logs = store.exportExecutionLogs(taskId);

    if (format === "csv") {
      const headers = ["id", "taskId", "threadId", "statusCode", "message", "userAgent", "locale", "region", "proxyRouteId", "durationMs", "createdAt"];
      const csvRows = [headers.join(",")];
      for (const log of logs) {
        const row = [
          log.id ?? "",
          log.taskId ?? "",
          log.threadId ?? "",
          log.statusCode ?? "",
          `"${String(log.message ?? "").replace(/"/g, '""')}"`,
          `"${String(log.userAgent ?? "").replace(/"/g, '""')}"`,
          log.locale ?? "",
          log.region ?? "",
          log.proxyRouteId ?? "",
          log.durationMs ?? 0,
          log.createdAt ?? ""
        ];
        csvRows.push(row.join(","));
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="dplt_execution_logs.csv"');
      res.send(csvRows.join("\n"));
      return;
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", 'attachment; filename="dplt_execution_logs.json"');
    res.json(logs);
  });

  router.post("/api/execution-logs/import", express.json({ limit: "50mb" }), (req, res) => {
    try {
      const body = req.body;
      let logsToImport: any[] = [];
      if (Array.isArray(body)) {
        logsToImport = body;
      } else if (body && Array.isArray(body.logs)) {
        logsToImport = body.logs;
      } else {
        res.status(400).json({ error: "Payload must be a JSON array of logs or an object with a logs array" });
        return;
      }

      const count = store.importExecutionLogs(logsToImport);
      io.emit("execution:imported", { count });
      res.json({ imported: count });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/api/analytics", (req, res) => {
    const startDate = typeof req.query.startDate === "string" && req.query.startDate.trim() ? req.query.startDate.trim() : undefined;
    const endDate = typeof req.query.endDate === "string" && req.query.endDate.trim() ? req.query.endDate.trim() : undefined;
    const startHour = typeof req.query.startHour === "string" && req.query.startHour.trim() !== "" ? parseInt(req.query.startHour, 10) : undefined;
    const endHour = typeof req.query.endHour === "string" && req.query.endHour.trim() !== "" ? parseInt(req.query.endHour, 10) : undefined;

    res.json(store.detailedAnalytics({ startDate, endDate, startHour, endHour }));
  });

  router.get("/api/stats", (_req, res) => {
    res.json(store.stats());
  });

  return router;
}

function toList(value: string | string[]) {
  const raw = Array.isArray(value) ? value : value.split(",");
  return raw.map((item) => item.trim()).filter(Boolean);
}
