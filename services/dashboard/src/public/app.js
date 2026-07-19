// ══════════════════════════════════════════════
// DPLT Control — app.js (Premium)
// ══════════════════════════════════════════════

const STORAGE_KEY = "dplt_saved_settings";

const socket = io();
const tasks  = new Map();

// ── DOM refs ──────────────────────────────────
const $  = (id) => document.getElementById(id);
const form          = $("taskForm");
const formMessage   = $("formMessage");
const socketStatus  = $("socketStatus");
const taskCount     = $("taskCount");
const taskStatusSummary = $("taskStatusSummary");
const activeTaskPreview = $("activeTaskPreview");
const taskModal = $("taskModal");
const openTaskCenterBtn = $("openTaskCenterBtn");
const closeTaskCenterBtn = $("closeTaskCenterBtn");
const taskModalCount = $("taskModalCount");
const taskGroupList = $("taskGroupList");
const logsEl        = $("logs");
const proxyPoolRows = $("proxyPoolRows");
const addProxyBtn   = $("addProxyBtn");
const saveBtn       = $("saveSettingsBtn");
const clearLogsBtn  = $("clearLogsBtn");
const launchChromeBtn = $("launchChromeBtn");
const cancelPendingBtn = $("cancelPendingBtn");
const cancelPendingInModalBtn = $("cancelPendingInModalBtn");
const logoutBtn = $("logoutBtn");

const TASK_STATUSES = ["pending", "queued", "running", "completed", "failed", "cancelled"];
const ACTIVE_STATUSES = ["pending", "queued", "running"];
const TASK_FILTER_LABELS = {
  active: "Active",
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  all: "All"
};
let currentTaskFilter = "active";

// ── Tabs ──────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  });
});

// ── Socket ────────────────────────────────────
socket.on("connect", () => {
  socketStatus.textContent = "Live";
  socketStatus.classList.add("live");
});

socket.on("disconnect", () => {
  socketStatus.textContent = "Disconnected";
  socketStatus.classList.remove("live");
  $("status-dot");
});

socket.on("snapshot", (snapshot) => {
  snapshot.tasks.forEach((t) => tasks.set(t.id, t));
  renderTasks();
  renderStats(snapshot.stats);
  if (snapshot.logs) {
    logsEl.innerHTML = "";
    const reversed = [...snapshot.logs].reverse();
    reversed.forEach((log) => addLog(log));
  }
});

socket.on("task:created", (task) => {
  tasks.set(task.id, task);
  renderTasks();
  refreshStats();
});

socket.on("task:updated", (task) => {
  tasks.set(task.id, task);
  renderTasks();
  refreshStats();
});

socket.on("execution:logged", (payload) => {
  addLog(payload.log);
  if (payload.task) {
    tasks.set(payload.task.id, payload.task);
    renderTasks();
  }
  refreshStats();
});

// ── Proxy pool ────────────────────────────────
let proxyRows = [];

addProxyBtn.addEventListener("click", () => {
  addProxyRow();
  autosave();
});

function addProxyRow(data = {}) {
  const rowId = Date.now() + "-" + Math.random().toString(36).slice(2);
  proxyRows.push(rowId);

  const div = document.createElement("div");
  div.className = "proxy-pool-row";
  div.dataset.rowId = rowId;
  div.innerHTML = `
    <div class="field-group">
      <label class="field-label">Proxy ID</label>
      <input class="field-input" data-key="id" placeholder="us-east-01" value="${esc(data.id ?? "")}" />
    </div>
    <div class="field-group">
      <label class="field-label">Server URL</label>
      <input class="field-input" data-key="server" placeholder="http://proxy.host:8080" value="${esc(data.server ?? "")}" />
    </div>
    <div class="field-group">
      <label class="field-label">Username</label>
      <input class="field-input" data-key="username" placeholder="user" value="${esc(data.username ?? "")}" />
    </div>
    <div class="field-group">
      <label class="field-label">Password</label>
      <input class="field-input" type="password" data-key="password" placeholder="••••••" value="${esc(data.password ?? "")}" />
    </div>
    <div class="field-group">
      <label class="field-label">Max uses</label>
      <input class="field-input" type="number" data-key="maxUsages" min="1" max="9999" placeholder="∞" value="${data.maxUsages ?? ""}" />
    </div>
    <div style="padding-top:20px">
      <button type="button" class="btn-icon-remove" title="Remove proxy" data-remove="${rowId}">✕</button>
    </div>
  `;

  proxyPoolRows.appendChild(div);

  div.querySelector(`[data-remove="${rowId}"]`).addEventListener("click", () => {
    proxyRows = proxyRows.filter((id) => id !== rowId);
    div.remove();
    autosave();
  });

  div.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", autosave));
}

function collectProxyRoutes() {
  return Array.from(proxyPoolRows.querySelectorAll(".proxy-pool-row"))
    .map((row) => {
      const get = (key) => row.querySelector(`[data-key="${key}"]`)?.value.trim() ?? "";
      const maxUsages = parseInt(row.querySelector('[data-key="maxUsages"]')?.value ?? "", 10);
      return {
        id:       get("id") || undefined,
        server:   get("server") || undefined,
        username: get("username") || undefined,
        password: get("password") || undefined,
        maxUsages: Number.isFinite(maxUsages) ? maxUsages : undefined
      };
    })
    .filter((r) => r.id);
}

// ── Form submit ───────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setFormMessage("Queuing…", "");

  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());

  // Build workflow config from named inputs
  const workflow = {
    entrySelector:         body.wf_entrySelector?.trim()         || undefined,
    targetAssetSelector:   body.wf_targetAssetSelector?.trim()   || undefined,
    selectionStateSelector:body.wf_selectionStateSelector?.trim()|| undefined,
    finalActionSelector:   body.wf_finalActionSelector?.trim()   || undefined,
    finalActionTexts:      body.wf_finalActionTexts?.trim()      || undefined
  };

  // Remove wf_ keys from root body
  Object.keys(body).forEach((k) => { if (k.startsWith("wf_")) delete body[k]; });

  // Attach structured data
  const proxyRoutes = collectProxyRoutes();
  if (proxyRoutes.length) body.proxyRoutes = proxyRoutes;

  const hasWorkflow = Object.values(workflow).some(Boolean);
  if (hasWorkflow) body.workflow = workflow;

  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setFormMessage("Error: " + (err?.error?.formErrors?.[0] ?? res.statusText), "err");
    return;
  }

  const { tasks: created, schedule } = await res.json();
  setFormMessage(
    `✓ Scheduled ${created.length} dispatch${created.length !== 1 ? "es" : ""} — active window ${schedule.activeHoursStart ?? 0}h → ${schedule.activeHoursEnd ?? 24}h`,
    "ok"
  );

  autosave();
});

// ── Save / restore settings ───────────────────
saveBtn.addEventListener("click", () => {
  autosave();
  setFormMessage("Settings saved.", "ok");
});

launchChromeBtn.addEventListener("click", async () => {
  launchChromeBtn.disabled = true;
  const originalText = launchChromeBtn.textContent;
  launchChromeBtn.textContent = "Launching...";
  
  try {
    const res = await fetch("/api/chrome/launch", { method: "POST" });
    if (res.ok) {
      setFormMessage("✓ Chrome launched successfully on port 9222.", "ok");
    } else {
      const err = await res.json().catch(() => ({}));
      setFormMessage("Error: " + (err.error ?? "Failed to launch Chrome"), "err");
    }
  } catch (e) {
    setFormMessage("Error connecting to server to launch Chrome", "err");
  } finally {
    launchChromeBtn.disabled = false;
    launchChromeBtn.textContent = originalText;
  }
});

function autosave() {
  const fd     = new FormData(form);
  const fields = Object.fromEntries(fd.entries());
  const proxies = collectProxyRoutes();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fields, proxies }));
  } catch { /* quota exceeded – ignore */ }
}

function restoreSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const { fields = {}, proxies = [] } = JSON.parse(raw);

    Object.entries(fields).forEach(([key, val]) => {
      const el = form.querySelector(`[name="${key}"]`);
      if (el && el.type !== "submit") el.value = val;
    });

    proxies.forEach((p) => addProxyRow(p));
  } catch { /* corrupt storage – ignore */ }
}

restoreSettings();

// Auto-save any direct field changes
form.querySelectorAll("input").forEach((inp) => {
  inp.addEventListener("change", autosave);
});

// ── Rendering ─────────────────────────────────
function renderTasks() {
  const allTasks = sortTasksForDisplay(Array.from(tasks.values()));
  const counts = countTasksByStatus(allTasks);
  const activeTasks = allTasks.filter((task) => ACTIVE_STATUSES.includes(task.status));

  taskCount.textContent = `${activeTasks.length} active / ${allTasks.length} loaded`;
  renderTaskStatusSummary(counts, allTasks.length);
  renderActiveTaskPreview(activeTasks);
  renderTaskCenter(allTasks, counts);
}

function renderTaskStatusSummary(counts, total) {
  const cards = [
    { filter: "active", label: "Active", value: ACTIVE_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0), note: "pending + queue + running" },
    { filter: "pending", label: "Pending", value: counts.pending ?? 0, note: "waiting for schedule" },
    { filter: "queued", label: "Queued", value: counts.queued ?? 0, note: "ready for runner" },
    { filter: "running", label: "Running", value: counts.running ?? 0, note: "in progress" },
    { filter: "completed", label: "Completed", value: counts.completed ?? 0, note: "finished" },
    { filter: "failed", label: "Failed", value: counts.failed ?? 0, note: "needs review" },
    { filter: "cancelled", label: "Cancelled", value: counts.cancelled ?? 0, note: "dismissed from main" },
    { filter: "all", label: "All", value: total, note: "loaded tasks" }
  ];

  taskStatusSummary.innerHTML = cards.map((card) => `
    <button type="button" class="task-status-card task-filter-${card.filter}" data-task-filter="${card.filter}">
      <span class="task-status-value">${card.value}</span>
      <span class="task-status-label">${esc(card.label)}</span>
      <span class="task-status-note">${esc(card.note)}</span>
    </button>
  `).join("");
}

function renderActiveTaskPreview(activeTasks) {
  const nextTasks = activeTasks.slice(0, 8);
  if (!nextTasks.length) {
    activeTaskPreview.innerHTML = `
      <div class="task-empty-state">
        <strong>No active queue</strong>
        <span>Pending, queued, and running tasks will appear here.</span>
      </div>
    `;
    return;
  }

  activeTaskPreview.innerHTML = `
    <div class="task-preview-header">
      <span>Next active tasks</span>
      <span>${nextTasks.length} shown</span>
    </div>
    <div class="task-preview-list">
      ${nextTasks.map(renderTaskPreviewRow).join("")}
    </div>
  `;
}

function renderTaskPreviewRow(task) {
  return `
    <article class="task-preview-row">
      <div class="task-preview-id">
        <code>${esc(task.id.slice(0, 8))}</code>
        <span class="status-badge s-${task.status}">${esc(task.status)}</span>
      </div>
      <div class="task-preview-target" title="${esc(task.targetUrl)}">${esc(task.targetUrl)}</div>
      <div class="task-preview-meta">
        <span>${task.scheduledAt ? fmtTime(task.scheduledAt) : "Immediate"}</span>
        <span>${esc(task.proxyRouteId ?? "no proxy")}</span>
      </div>
    </article>
  `;
}

function renderTaskCenter(allTasks, counts) {
  const filtered = filterTasks(allTasks, currentTaskFilter);
  const label = TASK_FILTER_LABELS[currentTaskFilter] ?? "Tasks";
  taskModalCount.textContent = `${label}: ${filtered.length} task${filtered.length !== 1 ? "s" : ""}`;
  updateTaskFilterButtons(counts, allTasks.length);

  if (!filtered.length) {
    taskGroupList.innerHTML = `
      <div class="task-empty-state task-empty-large">
        <strong>No ${esc(label.toLowerCase())} tasks</strong>
        <span>Change the filter to inspect another group.</span>
      </div>
    `;
    return;
  }

  const groups = groupTasksForFilter(filtered, currentTaskFilter);
  taskGroupList.innerHTML = groups.map(({ status, items }) => `
    <section class="task-group">
      <div class="task-group-header">
        <span class="status-badge s-${status}">${esc(status)}</span>
        <span>${items.length} task${items.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="task-card-list">
        ${items.map(renderTaskCard).join("")}
      </div>
    </section>
  `).join("");
}

function renderTaskCard(task) {
  const done = task.completedExecutions + task.failedExecutions;
  const pct = task.totalExecutions > 0 ? Math.min(100, Math.round((done / task.totalExecutions) * 100)) : 0;
  const canCancel = task.status === "pending" || task.status === "queued";

  return `
    <article class="task-card-row">
      <div class="task-card-main">
        <div class="task-card-title">
          <code>${esc(task.id.slice(0, 8))}</code>
          <span class="task-url" title="${esc(task.targetUrl)}">${esc(task.targetUrl)}</span>
        </div>
        <div class="task-card-meta">
          <span>Scheduled ${task.scheduledAt ? fmtTime(task.scheduledAt) : "Immediate"}</span>
          <span>Updated ${fmtTime(task.updatedAt)}</span>
          <span>Proxy ${esc(task.proxyRouteId ?? "none")}</span>
        </div>
      </div>
      <div class="task-progress">
        <div class="progress-track">
          <span class="progress-fill" style="width:${pct}%"></span>
        </div>
        <span>${done}/${task.totalExecutions}</span>
      </div>
      <div class="task-card-actions">
        ${canCancel ? `<button type="button" class="btn-danger-small" data-cancel-task="${esc(task.id)}">Cancel</button>` : `<span class="muted-text">—</span>`}
      </div>
    </article>
  `;
}

function countTasksByStatus(items) {
  return TASK_STATUSES.reduce((acc, status) => {
    acc[status] = items.filter((task) => task.status === status).length;
    return acc;
  }, {});
}

function filterTasks(items, filter) {
  if (filter === "all") return items;
  if (filter === "active") return items.filter((task) => ACTIVE_STATUSES.includes(task.status));
  return items.filter((task) => task.status === filter);
}

function groupTasksForFilter(items, filter) {
  const statuses = filter === "all"
    ? TASK_STATUSES
    : filter === "active"
      ? ACTIVE_STATUSES
      : [filter];

  return statuses
    .map((status) => ({
      status,
      items: sortTasksForDisplay(items.filter((task) => task.status === status))
    }))
    .filter((group) => group.items.length > 0);
}

function sortTasksForDisplay(items) {
  return items.sort((a, b) => {
    const aActive = ACTIVE_STATUSES.includes(a.status);
    const bActive = ACTIVE_STATUSES.includes(b.status);
    if (aActive && bActive) return taskTime(a, "scheduledAt") - taskTime(b, "scheduledAt");
    if (aActive !== bActive) return aActive ? -1 : 1;
    return taskTime(b, "updatedAt") - taskTime(a, "updatedAt");
  });
}

function taskTime(task, field) {
  const raw = task[field] ?? task.scheduledAt ?? task.createdAt ?? task.updatedAt;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function updateTaskFilterButtons(counts, total) {
  document.querySelectorAll("[data-task-filter]").forEach((button) => {
    const filter = button.dataset.taskFilter;
    button.classList.toggle("active", filter === currentTaskFilter);
    const count = filter === "all"
      ? total
      : filter === "active"
        ? ACTIVE_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0)
        : counts[filter] ?? 0;
    button.dataset.count = count;
  });
}

function setTaskFilter(filter) {
  currentTaskFilter = filter || "active";
  renderTasks();
}

function openTaskCenter(filter = currentTaskFilter) {
  setTaskFilter(filter);
  taskModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeTaskCenter() {
  taskModal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function cancelTask(taskId) {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" })
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const { task } = await res.json();
    tasks.set(task.id, task);
    renderTasks();
    refreshStats();
    setFormMessage(`Cancelled task ${task.id.slice(0, 8)}.`, "ok");
  } catch (err) {
    setFormMessage("Cancel failed: " + (err instanceof Error ? err.message : String(err)), "err");
  }
}

async function cancelPendingTasks() {
  try {
    cancelPendingBtn.disabled = true;
    cancelPendingInModalBtn.disabled = true;
    const res = await fetch("/api/tasks/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statuses: ["pending", "queued"] })
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const data = await res.json();
    for (const task of data.tasks ?? []) {
      tasks.set(task.id, task);
    }
    renderTasks();
    refreshStats();
    setFormMessage(`Cancelled ${data.cancelled ?? 0} pending/queued task${data.cancelled === 1 ? "" : "s"}.`, "ok");
  } catch (err) {
    setFormMessage("Bulk cancel failed: " + (err instanceof Error ? err.message : String(err)), "err");
  } finally {
    cancelPendingBtn.disabled = false;
    cancelPendingInModalBtn.disabled = false;
  }
}

async function refreshStats() {
  try {
    const res  = await fetch("/api/stats");
    const data = await res.json();
    renderStats(data);
  } catch { /* ignore */ }
}

function renderStats(stats) {
  const counts = Object.fromEntries((stats.taskCounts ?? []).map((r) => [r.status, r.count]));
  $("pendingCount").textContent   = counts.pending   ?? 0;
  $("queuedCount").textContent    = counts.queued    ?? 0;
  $("runningCount").textContent   = counts.running   ?? 0;
  $("runningCountTop").textContent = counts.running  ?? 0;
  $("completedCount").textContent = counts.completed ?? 0;
  $("failedCount").textContent    = counts.failed    ?? 0;
  $("cancelledCount").textContent = counts.cancelled ?? 0;
  renderRunSummary(stats.summary);

  // Proxy usage sidebar
  const proxyUsage = stats.proxyUsage ?? [];
  const list = $("proxyUsageList");
  if (proxyUsage.length === 0) {
    list.innerHTML = `<p class="muted-text">No proxy usage recorded yet.</p>`;
    return;
  }
  const max = Math.max(...proxyUsage.map((p) => p.usages), 1);
  list.innerHTML = proxyUsage.map(({ proxyRouteId, usages }) => `
    <div class="proxy-usage-row">
      <span class="proxy-usage-id">${esc(proxyRouteId)}</span>
      <div class="proxy-usage-bar-wrap">
        <div class="proxy-usage-bar" style="width:${Math.round((usages / max) * 100)}%"></div>
      </div>
      <span class="proxy-usage-count">${usages}×</span>
    </div>`).join("");
}

function renderRunSummary(summary = {}) {
  $("summaryTotal").textContent = summary.totalRuns ?? 0;
  $("summaryCompleted").textContent = summary.completedRuns ?? 0;
  $("summaryFailed").textContent = summary.failedRuns ?? 0;
  $("summaryAvgDuration").textContent = fmtDuration(summary.avgDurationMs ?? 0);
  $("summaryUpdated").textContent = "Updated " + fmtClock(new Date());

  const workflow = summary.workflow ?? {};
  $("summarySubmitClicks").textContent = workflow.commit?.matched ?? 0;
  $("workflowStageRows").innerHTML = [
    renderWorkflowStage("Entry", workflow.entry),
    renderWorkflowStage("Target", workflow.selection),
    renderWorkflowStage("Submit", workflow.commit)
  ].join("");

  const failures = summary.recentFailures ?? [];
  $("recentFailureList").innerHTML = failures.length
    ? failures.map((failure) => `
      <div class="failure-row">
        <code>${esc(failure.taskId?.slice(0, 8) ?? "unknown")}/${esc(failure.threadId ?? "thread")}</code>
        <span class="failure-message" title="${esc(failure.message)}">${esc(failure.message)}</span>
        <span class="proxy-usage-id">${esc(failure.proxyRouteId ?? "—")}</span>
      </div>
    `).join("")
    : `<p class="muted-text">No failures recorded yet.</p>`;
}

function renderWorkflowStage(label, stage = {}) {
  const matched = stage.matched ?? 0;
  const failed = stage.failed ?? 0;
  const skipped = stage.skipped ?? 0;
  return `
    <div class="workflow-stage-card">
      <div class="workflow-stage-title">
        <span>${esc(label)}</span>
        <span class="workflow-stage-count">${matched}/${stage.total ?? 0}</span>
      </div>
      <div class="stage-bar" style="--ok:${matched}fr;--fail:${failed}fr;--skip:${skipped}fr">
        <span class="stage-ok" title="${matched} matched"></span>
        <span class="stage-fail" title="${failed} failed"></span>
        <span class="stage-skip" title="${skipped} skipped"></span>
      </div>
      <div class="stage-breakdown">
        <span class="stage-pill ok">${matched} done</span>
        <span class="stage-pill fail">${failed} failed</span>
        <span class="stage-pill skip">${skipped} skipped</span>
      </div>
    </div>
  `;
}

let currentLogFilter = "all";

document.querySelectorAll(".btn-filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".btn-filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentLogFilter = btn.dataset.filter;
    applyLogFilters();
  });
});

function applyLogFilters() {
  document.querySelectorAll(".log-line").forEach((line) => {
    const status = line.dataset.status;
    if (currentLogFilter === "all") {
      line.style.display = "";
    } else if (currentLogFilter === "completed" && status === "completed") {
      line.style.display = "";
    } else if (currentLogFilter === "failed" && status === "failed") {
      line.style.display = "";
    } else {
      line.style.display = "none";
    }
  });
}

function addLog(log) {
  const div = document.createElement("div");
  div.className = "log-line";
  div.dataset.status = log.statusCode;
  const ok = log.statusCode === "completed";
  const meta = parseMetadata(log.metadata);
  const routedIp = meta.routedIp || "—";
  const stepPillsHtml = renderStepPills(meta.workflow);

  let detailsHtml = "";
  if (log.metadata) {
    const details = [];

    if (log.message) {
      details.push({ label: "Message / Error", val: log.message });
    }
    if (log.durationMs) {
      details.push({ label: "Duration", val: `${log.durationMs}ms` });
    }
    if (meta.finalUrl) {
      details.push({ label: "Final URL", val: meta.finalUrl });
    }
    if (meta.title) {
      details.push({ label: "Page Title", val: meta.title });
    }
    if (meta.hostIp || meta.routedIp) {
      details.push({
        label: "IP Isolation",
        val: `Host: ${meta.hostIp || "—"} | Proxy Routed: ${meta.routedIp || "—"}`
      });
    }
    if (meta.localization) {
      details.push({
        label: "Localization",
        val: `Lang: ${meta.localization.language || "—"} | TZ: ${meta.localization.timezone || "—"}`
      });
    }
    if (meta.graphicsAudit) {
      details.push({
        label: "Graphics Audit",
        val: `Vendor: ${meta.graphicsAudit.observed?.webgl?.unmaskedVendor || "—"} | Renderer: ${meta.graphicsAudit.observed?.webgl?.unmaskedRenderer || "—"} | Matches Expected: ${meta.graphicsAudit.matchesExpectedFamily}`
      });
    }
    if (meta.workflow) {
      const steps = [];
      if (meta.workflow.entry) {
        steps.push(`Entry: ${meta.workflow.entry.matched ? "✓" : "✗"}${meta.workflow.entry.value ? " (" + meta.workflow.entry.value + ")" : ""}`);
      }
      if (meta.workflow.selection) {
        steps.push(`Selection: ${meta.workflow.selection.matched ? "✓" : "✗"}`);
      }
      if (meta.workflow.commit) {
        steps.push(`Commit: ${meta.workflow.commit.matched ? "✓" : "✗"}`);
      }
      details.push({ label: "Workflow Steps", val: steps.join(" | ") || "None" });
    }

    // Screenshot — rendered as image, not text
    const screenshotBase64 = meta.screenshotBase64 ?? null;

    // Strip screenshot from raw dump so it doesn't clog the JSON view
    const metaDump = { ...meta };
    delete metaDump.screenshotBase64;
    details.push({ label: "Raw Telemetry", val: JSON.stringify(metaDump, null, 2), isJson: true });

    detailsHtml = `
      <div class="log-details">
        ${screenshotBase64 ? `
          <div class="log-screenshot-wrap">
            <div class="log-details-label" style="margin-bottom:8px">Proof Screenshot</div>
            <img class="log-screenshot" src="data:image/jpeg;base64,${screenshotBase64}" alt="proof screenshot" />
          </div>
        ` : ""}
        <div class="log-details-grid">
          ${details
            .map(
              (d) => `
            <span class="log-details-label">${esc(d.label)}</span>
            <span class="log-details-val ${d.isJson ? "json" : ""}">${esc(d.val)}</span>
          `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  const timestamp = fmtLogTime(log.createdAt);

  div.innerHTML = `
    <div class="log-header">
      <span class="log-caret">▶</span>
      <span class="log-ts">${timestamp}</span>
      <span class="log-status ${ok ? "ok" : "fail"}">${ok ? "✓ OK" : "✗ FAIL"}</span>
      <span class="log-meta">task=${log.taskId.slice(0, 8)} thread=${log.threadId} proxy=${esc(log.proxyRouteId)} ip=<span class="log-ip">${esc(routedIp)}</span> locale=${log.locale} region=${log.region}</span>
    </div>
    ${stepPillsHtml}
    ${detailsHtml}
  `;

  div.addEventListener("click", (e) => {
    if (window.getSelection().toString() || e.target.closest(".json")) return;
    div.classList.toggle("expanded");
  });

  logsEl.prepend(div);

  // Apply visibility filtering matching current filter
  if (currentLogFilter !== "all" && currentLogFilter !== log.statusCode) {
    div.style.display = "none";
  }

  // Keep log list bounded
  while (logsEl.children.length > 300) logsEl.removeChild(logsEl.lastChild);
}

clearLogsBtn.addEventListener("click", () => { logsEl.innerHTML = ""; });

async function confirmCancelPendingTasks() {
  const count = Array.from(tasks.values()).filter((task) => ["pending", "queued"].includes(task.status)).length;
  if (count === 0) {
    setFormMessage("No pending or queued tasks to cancel.", "");
    return false;
  }
  if (!window.confirm(`Cancel ${count} pending/queued task${count !== 1 ? "s" : ""}?`)) {
    return false;
  }
  await cancelPendingTasks();
  return true;
}

cancelPendingBtn.addEventListener("click", confirmCancelPendingTasks);
cancelPendingInModalBtn.addEventListener("click", confirmCancelPendingTasks);

openTaskCenterBtn.addEventListener("click", () => openTaskCenter());
closeTaskCenterBtn.addEventListener("click", closeTaskCenter);
taskModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-task-modal]")) closeTaskCenter();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !taskModal.hidden) closeTaskCenter();
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/auth.html";
});

document.querySelectorAll(".task-filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => setTaskFilter(btn.dataset.taskFilter));
});

taskStatusSummary.addEventListener("click", (event) => {
  const button = event.target.closest("[data-task-filter]");
  if (!button) return;
  openTaskCenter(button.dataset.taskFilter);
});

taskGroupList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-cancel-task]");
  if (!button) return;
  const taskId = button.dataset.cancelTask;
  if (!taskId) return;
  button.disabled = true;
  await cancelTask(taskId);
});

renderTasks();

// ── Utilities ─────────────────────────────────
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function fmtClock(date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function fmtLogTime(iso) {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function fmtDuration(ms) {
  if (!ms) return "0ms";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function parseMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata !== "string") return metadata;
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

function renderStepPills(workflow) {
  if (!workflow) return "";
  const steps = [
    ["Entry", workflow.entry],
    ["Target", workflow.selection],
    ["Submit", workflow.commit]
  ].filter(([, step]) => step);
  if (!steps.length) return "";

  return `
    <div class="log-step-pills">
      ${steps.map(([label, step]) => {
        const cls = step.strategy === "skipped" ? "skip" : step.matched ? "ok" : "fail";
        const text = step.strategy === "skipped" ? "skipped" : step.matched ? "done" : "failed";
        return `<span class="step-pill ${cls}" title="${esc(step.value ?? "")}">${esc(label)} ${text}</span>`;
      }).join("")}
    </div>
  `;
}

function setFormMessage(text, cls) {
  formMessage.textContent = text;
  formMessage.className   = "form-message " + cls;
}
