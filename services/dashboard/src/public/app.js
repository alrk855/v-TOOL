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
const taskInspectorModal = $("taskInspectorModal");
const closeInspectorBtn = $("closeInspectorBtn");
const closeInspectorBackdrop = $("closeInspectorBackdrop");
const inspectorStatus = $("inspectorStatus");
const inspectorTaskId = $("inspectorTaskId");
const inspectorContent = $("inspectorContent");
const clearCancelledBtn = $("clearCancelledBtn");
const clearCancelledInModalBtn = $("clearCancelledInModalBtn");
const batchFilterSelect = $("batchFilterSelect");
const openAnalyticsModalBtn = $("openAnalyticsModalBtn");
const analyticsModal = $("analyticsModal");
const closeAnalyticsBtn = $("closeAnalyticsBtn");
const closeAnalyticsBackdrop = $("closeAnalyticsBackdrop");
const analyticsContent = $("analyticsContent");
const exportLogsJsonBtn = $("exportLogsJsonBtn");
const exportLogsCsvBtn = $("exportLogsCsvBtn");
const importLogsBtn = $("importLogsBtn");
const importLogFileInput = $("importLogFileInput");
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
let currentBatchFilter = "all";
let activeInspectedTaskId = null;

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
  if (activeInspectedTaskId === task.id) {
    renderTaskInspector(task);
  }
});

socket.on("task:deleted", ({ id }) => {
  tasks.delete(id);
  renderTasks();
  refreshStats();
  if (activeInspectedTaskId === id) {
    closeTaskInspector();
  }
});

socket.on("tasks:purged", ({ status }) => {
  if (status === "cancelled") {
    for (const [id, task] of tasks.entries()) {
      if (task.status === "cancelled") {
        tasks.delete(id);
      }
    }
  }
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

socket.on("execution:imported", ({ count }) => {
  refreshStats();
  if (analyticsModal && !analyticsModal.hidden) {
    loadAndRenderAnalytics();
  }
  setFormMessage(`✓ ${count} execution log records imported successfully.`, "ok");
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
    <article class="task-preview-row" data-inspect-task="${esc(task.id)}" style="cursor:pointer">
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
  updateBatchFilterDropdown(allTasks);
  const filtered = filterTasks(allTasks, currentTaskFilter, currentBatchFilter);
  const label = TASK_FILTER_LABELS[currentTaskFilter] ?? "Tasks";
  const batchLabel = currentBatchFilter !== "all" ? ` [Batch: ${currentBatchFilter.slice(0, 14)}]` : "";
  taskModalCount.textContent = `${label}${batchLabel}: ${filtered.length} task${filtered.length !== 1 ? "s" : ""}`;
  updateTaskFilterButtons(counts, allTasks.length);

  if (!filtered.length) {
    taskGroupList.innerHTML = `
      <div class="task-empty-state task-empty-large">
        <strong>No ${esc(label.toLowerCase())} tasks</strong>
        <span>Change status or batch/queue filter to inspect another group.</span>
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

function updateBatchFilterDropdown(allTasks) {
  if (!batchFilterSelect) return;
  const batches = new Map();
  for (const task of allTasks) {
    const bId = task.batchId ?? "default";
    batches.set(bId, (batches.get(bId) ?? 0) + 1);
  }

  const currentSelection = currentBatchFilter;
  const optionsHtml = ['<option value="all">All Batches / Queues</option>'];
  for (const [bId, count] of batches.entries()) {
    const label = bId === "default" ? `Default Queue (${count})` : `Queue: ${bId.slice(0, 16)} (${count})`;
    optionsHtml.push(`<option value="${esc(bId)}" ${bId === currentSelection ? "selected" : ""}>${esc(label)}</option>`);
  }
  batchFilterSelect.innerHTML = optionsHtml.join("");
}

if (batchFilterSelect) {
  batchFilterSelect.addEventListener("change", () => {
    currentBatchFilter = batchFilterSelect.value;
    renderTasks();
  });
}

function renderTaskCard(task) {
  const done = task.completedExecutions + task.failedExecutions;
  const pct = task.totalExecutions > 0 ? Math.min(100, Math.round((done / task.totalExecutions) * 100)) : 0;
  const canCancel = task.status === "pending" || task.status === "queued";
  const batchBadge = task.batchId ? `<span class="step-pill ok" style="font-size:9px">Queue: ${esc(task.batchId.slice(0, 10))}</span>` : "";

  return `
    <article class="task-card-row" data-inspect-task="${esc(task.id)}" style="cursor:pointer">
      <div class="task-card-main">
        <div class="task-card-title">
          <code>${esc(task.id.slice(0, 8))}</code>
          ${batchBadge}
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
      <div class="task-card-actions" onclick="event.stopPropagation()">
        <button type="button" class="btn-secondary-small" data-inspect-task="${esc(task.id)}">Details</button>
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

function filterTasks(items, statusFilter, batchFilter = "all") {
  let result = items;
  if (batchFilter !== "all") {
    result = result.filter((task) => (task.batchId ?? "default") === batchFilter);
  }
  if (statusFilter === "all") return result;
  if (statusFilter === "active") return result.filter((task) => ACTIVE_STATUSES.includes(task.status));
  return result.filter((task) => task.status === statusFilter);
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

if (clearCancelledBtn) clearCancelledBtn.addEventListener("click", clearCancelledTasks);
if (clearCancelledInModalBtn) clearCancelledInModalBtn.addEventListener("click", clearCancelledTasks);

openTaskCenterBtn.addEventListener("click", () => openTaskCenter());
closeTaskCenterBtn.addEventListener("click", closeTaskCenter);
if (closeInspectorBtn) closeInspectorBtn.addEventListener("click", closeTaskInspector);
if (closeInspectorBackdrop) closeInspectorBackdrop.addEventListener("click", closeTaskInspector);

// ── Analytics Modal ───────────────────────────
if (openAnalyticsModalBtn) {
  openAnalyticsModalBtn.addEventListener("click", () => {
    analyticsModal.hidden = false;
    loadAndRenderAnalytics();
  });
}
if (closeAnalyticsBtn) closeAnalyticsBtn.addEventListener("click", () => { analyticsModal.hidden = true; });
if (closeAnalyticsBackdrop) closeAnalyticsBackdrop.addEventListener("click", () => { analyticsModal.hidden = true; });

// ── Export Logs ───────────────────────────────
if (exportLogsJsonBtn) {
  exportLogsJsonBtn.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = "/api/execution-logs/export?format=json";
    a.download = "dplt_execution_logs.json";
    a.click();
  });
}
if (exportLogsCsvBtn) {
  exportLogsCsvBtn.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = "/api/execution-logs/export?format=csv";
    a.download = "dplt_execution_logs.csv";
    a.click();
  });
}

// ── Import Logs ───────────────────────────────
if (importLogsBtn && importLogFileInput) {
  importLogsBtn.addEventListener("click", () => importLogFileInput.click());

  importLogFileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    importLogsBtn.disabled = true;
    importLogsBtn.textContent = "Importing…";

    try {
      const text = await file.text();
      let payload;

      if (file.name.endsWith(".csv")) {
        // Parse CSV into log-like objects
        const lines = text.split("\n").filter(Boolean);
        const headers = lines[0].split(",");
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(",");
          const obj = {};
          headers.forEach((h, idx) => { obj[h.trim()] = (vals[idx] ?? "").replace(/^"|"$/g, "").trim(); });
          rows.push(obj);
        }
        payload = rows;
      } else {
        payload = JSON.parse(text);
      }

      const res = await fetch("/api/execution-logs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Array.isArray(payload) ? payload : [payload])
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setFormMessage(`✓ Imported ${data.imported} records from ${file.name}`, "ok");
      if (analyticsModal && !analyticsModal.hidden) loadAndRenderAnalytics();
    } catch (err) {
      setFormMessage(`✗ Import error: ${err.message}`, "error");
    } finally {
      importLogsBtn.disabled = false;
      importLogsBtn.textContent = "⬆ Import Logs";
      importLogFileInput.value = "";
    }
  });
}

taskModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-task-modal]")) closeTaskCenter();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (analyticsModal && !analyticsModal.hidden) {
      analyticsModal.hidden = true;
    } else if (!taskInspectorModal.hidden) {
      closeTaskInspector();
    } else if (!taskModal.hidden) {
      closeTaskCenter();
    }
  }
});

// Delegate click events to open Task Inspector Modal
document.addEventListener("click", (event) => {
  const inspectTarget = event.target.closest("[data-inspect-task]");
  if (inspectTarget && !event.target.closest("[data-cancel-task]")) {
    const taskId = inspectTarget.dataset.inspectTask;
    if (taskId) {
      openTaskInspector(taskId);
    }
  }
});

// ── Task Inspector & Management ─────────────────
function openTaskInspector(taskIdOrTask) {
  const task = typeof taskIdOrTask === "string" ? tasks.get(taskIdOrTask) : taskIdOrTask;
  if (!task) return;
  activeInspectedTaskId = task.id;
  renderTaskInspector(task);
  taskInspectorModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeTaskInspector() {
  activeInspectedTaskId = null;
  taskInspectorModal.hidden = true;
  if (taskModal.hidden) {
    document.body.classList.remove("modal-open");
  }
}

function renderTaskInspector(task) {
  inspectorStatus.textContent = task.status;
  inspectorStatus.className = `status-badge s-${task.status}`;
  inspectorTaskId.textContent = task.id;

  const scheduledTime = task.scheduledAt ? new Date(task.scheduledAt).getTime() : null;
  const now = Date.now();
  let timeCountdownStr = "Immediate / Queued";
  if (scheduledTime) {
    const diffMs = scheduledTime - now;
    if (diffMs > 0) {
      const min = Math.floor(diffMs / 60000);
      const sec = Math.floor((diffMs % 60000) / 1000);
      timeCountdownStr = `Fires in ${min}m ${sec}s (${fmtTime(task.scheduledAt)})`;
    } else {
      timeCountdownStr = `Scheduled for ${fmtTime(task.scheduledAt)} (${fmtDuration(Math.abs(diffMs))} ago)`;
    }
  }

  const done = task.completedExecutions + task.failedExecutions;
  const canCancel = task.status === "pending" || task.status === "queued" || task.status === "running";
  const canRequeue = task.status === "completed" || task.status === "failed" || task.status === "cancelled";

  const workflow = task.workflow ?? {};
  const workflowSummaryStr = [
    workflow.entrySelector ? `Entry: ${workflow.entrySelector}` : null,
    workflow.targetAssetSelector ? `Target: ${workflow.targetAssetSelector}` : null,
    workflow.finalActionSelector ? `Submit: ${workflow.finalActionSelector}` : null
  ].filter(Boolean).join(" | ") || "Default workflow";

  inspectorContent.innerHTML = `
    <div class="inspector-card">
      <div class="inspector-card-title">Target & Execution Progress</div>
      <div class="inspector-grid">
        <span class="inspector-label">Target URL:</span>
        <span class="inspector-val"><a href="${esc(task.targetUrl)}" target="_blank" rel="noopener" style="color:var(--accent-primary)">${esc(task.targetUrl)} ↗</a></span>
        
        <span class="inspector-label">Schedule Window:</span>
        <span class="inspector-val"><strong>${esc(timeCountdownStr)}</strong></span>

        <span class="inspector-label">Executions:</span>
        <span class="inspector-val">${done} / ${task.totalExecutions} (${task.completedExecutions} OK, ${task.failedExecutions} Failed)</span>

        <span class="inspector-label">Assigned Proxy:</span>
        <span class="inspector-val"><code>${esc(task.proxyRouteId ?? "no proxy assigned")}</code></span>
        
        <span class="inspector-label">Locales & Regions:</span>
        <span class="inspector-val">${esc((task.locales ?? []).join(", "))} | ${esc((task.regions ?? []).join(", "))}</span>

        <span class="inspector-label">Timestamps:</span>
        <span class="inspector-val">Created ${fmtTime(task.createdAt)} | Updated ${fmtTime(task.updatedAt)}</span>
      </div>
    </div>

    <!-- POSTPONE & RESCHEDULE CONTROL -->
    <div class="inspector-card">
      <div class="inspector-card-title">🕒 Postpone / Reschedule Task</div>
      <p class="muted-text" style="font-size:12px;margin:0">Delay execution time to a future window:</p>
      <div class="postpone-preset-row">
        <button type="button" class="preset-btn" data-postpone-mins="15">+15 Minutes</button>
        <button type="button" class="preset-btn" data-postpone-mins="30">+30 Minutes</button>
        <button type="button" class="preset-btn" data-postpone-mins="60">+1 Hour</button>
        <button type="button" class="preset-btn" data-postpone-mins="240">+4 Hours</button>
        <button type="button" class="preset-btn" data-postpone-mins="1440">+24 Hours</button>
      </div>
      <div class="custom-datetime-row">
        <label class="field-label-small">Or Set Date/Time:</label>
        <input type="datetime-local" id="customSchedulePicker" />
        <button type="button" class="btn-secondary-small" id="applyCustomScheduleBtn">Set Schedule</button>
      </div>
    </div>

    <!-- WORKFLOW SELECTORS -->
    <div class="inspector-card">
      <div class="inspector-card-title">Workflow Selectors</div>
      <div class="inspector-val" style="font-family:var(--font-mono);font-size:11.5px">${esc(workflowSummaryStr)}</div>
    </div>

    <!-- ACTIONS TOOLBAR -->
    <div class="inspector-actions">
      ${canRequeue ? `<button type="button" class="btn-primary" id="requeueTaskBtn">🔄 Re-Queue / Retry Task</button>` : ""}
      ${canCancel ? `<button type="button" class="btn-danger-small" id="cancelInspectorTaskBtn">❌ Cancel Task</button>` : ""}
      <button type="button" class="btn-secondary-small" id="deleteInspectorTaskBtn" style="color:var(--accent-fail)">🗑️ Delete Task</button>
    </div>
  `;

  const content = inspectorContent;
  content.querySelectorAll("[data-postpone-mins]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mins = parseInt(btn.dataset.postponeMins, 10);
      await postponeTask(task.id, { delayMinutes: mins });
    });
  });

  const customPicker = $("customSchedulePicker");
  const applyCustomBtn = $("applyCustomScheduleBtn");
  if (customPicker && applyCustomBtn) {
    applyCustomBtn.addEventListener("click", async () => {
      if (!customPicker.value) return;
      const iso = new Date(customPicker.value).toISOString();
      await postponeTask(task.id, { scheduledAt: iso });
    });
  }

  const requeueBtn = $("requeueTaskBtn");
  if (requeueBtn) {
    requeueBtn.addEventListener("click", async () => {
      await requeueTask(task.id);
    });
  }

  const cancelBtn = $("cancelInspectorTaskBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", async () => {
      await cancelTask(task.id);
    });
  }

  const deleteBtn = $("deleteInspectorTaskBtn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      if (window.confirm("Permanently delete this task and its logs?")) {
        await deleteTask(task.id);
      }
    });
  }
}

async function postponeTask(taskId, options) {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/postpone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options)
    });
    if (!res.ok) throw new Error(await res.text());
    const { task } = await res.json();
    tasks.set(task.id, task);
    renderTasks();
    refreshStats();
    setFormMessage(`✓ Postponed task ${task.id.slice(0, 8)} to ${fmtTime(task.scheduledAt)}.`, "ok");
  } catch (err) {
    setFormMessage("Postpone failed: " + (err instanceof Error ? err.message : String(err)), "err");
  }
}

async function requeueTask(taskId) {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/requeue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) throw new Error(await res.text());
    const { task } = await res.json();
    tasks.set(task.id, task);
    renderTasks();
    refreshStats();
    setFormMessage(`✓ Task ${task.id.slice(0, 8)} re-queued.`, "ok");
  } catch (err) {
    setFormMessage("Re-queue failed: " + (err instanceof Error ? err.message : String(err)), "err");
  }
}

async function deleteTask(taskId) {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE"
    });
    if (!res.ok) throw new Error(await res.text());
    tasks.delete(taskId);
    renderTasks();
    refreshStats();
    closeTaskInspector();
    setFormMessage(`Deleted task ${taskId.slice(0, 8)}.`, "ok");
  } catch (err) {
    setFormMessage("Delete failed: " + (err instanceof Error ? err.message : String(err)), "err");
  }
}

async function clearCancelledTasks() {
  const cancelledCount = Array.from(tasks.values()).filter((t) => t.status === "cancelled").length;
  if (cancelledCount === 0) {
    setFormMessage("No cancelled tasks to clear.", "");
    return;
  }
  if (!window.confirm(`Permanently purge ${cancelledCount} cancelled task${cancelledCount !== 1 ? "s" : ""} from database?`)) {
    return;
  }
  try {
    const res = await fetch("/api/tasks/clear-cancelled", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    const { cleared } = await res.json();
    for (const [id, task] of tasks.entries()) {
      if (task.status === "cancelled") {
        tasks.delete(id);
      }
    }
    renderTasks();
    refreshStats();
    setFormMessage(`✓ Cleared ${cleared} cancelled tasks from database.`, "ok");
  } catch (err) {
    setFormMessage("Clear failed: " + (err instanceof Error ? err.message : String(err)), "err");
  }
}

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

// ══════════════════════════════════════════════════════════
//   ANALYTICS & CHARTS
// ══════════════════════════════════════════════════════════

let currentAnalyticsFilter = {
  preset: "all",
  startDate: "",
  endDate: "",
  startHour: 0,
  endHour: 23
};

function initAnalyticsFilterControls() {
  const startHourEl = $("analyticsStartHour");
  const endHourEl = $("analyticsEndHour");

  if (startHourEl && startHourEl.options.length === 0) {
    for (let h = 0; h < 24; h++) {
      const val = String(h);
      const label = `${String(h).padStart(2, "0")}:00`;
      startHourEl.add(new Option(label, val));
      endHourEl.add(new Option(label, val));
    }
    startHourEl.value = "0";
    endHourEl.value = "23";
  }

  // Bind presets
  document.querySelectorAll(".analytics-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".analytics-preset-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      applyPresetFilter(btn.dataset.preset);
    });
  });

  const applyBtn = $("applyAnalyticsFilterBtn");
  const resetBtn = $("resetAnalyticsFilterBtn");

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      currentAnalyticsFilter.preset = "custom";
      document.querySelectorAll(".analytics-preset-btn").forEach((b) => b.classList.remove("active"));
      currentAnalyticsFilter.startDate = $("analyticsStartDate").value;
      currentAnalyticsFilter.endDate = $("analyticsEndDate").value;
      currentAnalyticsFilter.startHour = parseInt($("analyticsStartHour").value || "0", 10);
      currentAnalyticsFilter.endHour = parseInt($("analyticsEndHour").value || "23", 10);
      loadAndRenderAnalytics();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      applyPresetFilter("all");
    });
  }
}

function applyPresetFilter(preset) {
  currentAnalyticsFilter.preset = preset;
  const now = new Date();
  const startInput = $("analyticsStartDate");
  const endInput = $("analyticsEndDate");
  const startHourEl = $("analyticsStartHour");
  const endHourEl = $("analyticsEndHour");

  if (preset === "all") {
    currentAnalyticsFilter.startDate = "";
    currentAnalyticsFilter.endDate = "";
    currentAnalyticsFilter.startHour = 0;
    currentAnalyticsFilter.endHour = 23;
    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
  } else if (preset === "24h") {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    currentAnalyticsFilter.startDate = yesterday.toISOString().slice(0, 10);
    currentAnalyticsFilter.endDate = now.toISOString().slice(0, 10);
    if (startInput) startInput.value = currentAnalyticsFilter.startDate;
    if (endInput) endInput.value = currentAnalyticsFilter.endDate;
  } else if (preset === "7d") {
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    currentAnalyticsFilter.startDate = d7.toISOString().slice(0, 10);
    currentAnalyticsFilter.endDate = now.toISOString().slice(0, 10);
    if (startInput) startInput.value = currentAnalyticsFilter.startDate;
    if (endInput) endInput.value = currentAnalyticsFilter.endDate;
  } else if (preset === "30d") {
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    currentAnalyticsFilter.startDate = d30.toISOString().slice(0, 10);
    currentAnalyticsFilter.endDate = now.toISOString().slice(0, 10);
    if (startInput) startInput.value = currentAnalyticsFilter.startDate;
    if (endInput) endInput.value = currentAnalyticsFilter.endDate;
  }

  if (startHourEl) startHourEl.value = "0";
  if (endHourEl) endHourEl.value = "23";
  currentAnalyticsFilter.startHour = 0;
  currentAnalyticsFilter.endHour = 23;

  loadAndRenderAnalytics();
}

async function loadAndRenderAnalytics() {
  if (!analyticsContent) return;
  initAnalyticsFilterControls();

  analyticsContent.innerHTML = `
    <div class="task-empty-state" style="padding:40px">
      <strong>Loading analytics…</strong>
    </div>`;

  try {
    const params = new URLSearchParams();
    if (currentAnalyticsFilter.startDate) params.set("startDate", currentAnalyticsFilter.startDate);
    if (currentAnalyticsFilter.endDate) params.set("endDate", currentAnalyticsFilter.endDate);
    if (typeof currentAnalyticsFilter.startHour === "number") params.set("startHour", String(currentAnalyticsFilter.startHour));
    if (typeof currentAnalyticsFilter.endHour === "number") params.set("endHour", String(currentAnalyticsFilter.endHour));

    const url = "/api/analytics" + (params.toString() ? "?" + params.toString() : "");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderAnalyticsContent(data);
  } catch (err) {
    analyticsContent.innerHTML = `
      <div class="task-empty-state" style="padding:40px">
        <strong>Failed to load analytics: ${esc(err.message)}</strong>
      </div>`;
  }
}

function renderAnalyticsContent(d) {
  if (!analyticsContent) return;

  const successRate = d.effectiveSuccessRate ?? 0;
  const rateColor = successRate >= 80 ? "ok" : successRate >= 50 ? "warn" : "fail";
  const avgDurStr = d.avgDurationMs ? fmtDuration(d.avgDurationMs) : "—";

  analyticsContent.innerHTML = `
    <!-- KPI Summary Strip -->
    <div class="analytics-kpi-grid">
      <div class="analytics-kpi-card ok">
        <span class="analytics-kpi-num">${d.effectiveCompletedRuns ?? 0}</span>
        <span class="analytics-kpi-label">Effective Runs<br><small style="font-size:9px;color:var(--text-muted)">Success + Timeout</small></span>
      </div>
      <div class="analytics-kpi-card ok">
        <span class="analytics-kpi-num">${d.totalCommitClicks ?? 0}</span>
        <span class="analytics-kpi-label">Total Clicks / Submits</span>
      </div>
      <div class="analytics-kpi-card warn">
        <span class="analytics-kpi-num">${d.timeoutRuns ?? 0}</span>
        <span class="analytics-kpi-label">Timeouts<br><small style="font-size:9px;color:var(--text-muted)">Counted as completed</small></span>
      </div>
      <div class="analytics-kpi-card fail">
        <span class="analytics-kpi-num">${d.hardFailedRuns ?? 0}</span>
        <span class="analytics-kpi-label">Hard Failures</span>
      </div>
      <div class="analytics-kpi-card ${rateColor}">
        <span class="analytics-kpi-num">${successRate}%</span>
        <span class="analytics-kpi-label">Effective Success Rate</span>
      </div>
      <div class="analytics-kpi-card">
        <span class="analytics-kpi-num">${d.totalRuns ?? 0}</span>
        <span class="analytics-kpi-label">Total Executions</span>
      </div>
    </div>

    <!-- Daily Chart -->
    ${renderDailyBarChart(d.dailySeries ?? [])}

    <!-- Hourly Heatmap -->
    ${renderHourlyChart(d.hourlyStats ?? [])}

    <!-- Workflow Funnel -->
    ${renderWorkflowFunnel(d.workflowSteps, d.totalRuns)}

    <!-- Proxy Breakdown -->
    ${renderProxyTable(d.proxyStats ?? [])}

    <!-- Daily Detail Table -->
    ${renderDailyTable(d.dailySeries ?? [])}

    <!-- Export Actions -->
    <div style="display:flex;gap:10px;margin-top:4px">
      <button type="button" class="btn-secondary-small" id="analyticsExportJsonBtn">⬇ Export Logs JSON</button>
      <button type="button" class="btn-secondary-small" id="analyticsExportCsvBtn">⬇ Export Logs CSV</button>
    </div>
  `;

  // Bind inline export buttons
  const ejBtn = analyticsContent.querySelector("#analyticsExportJsonBtn");
  const ecBtn = analyticsContent.querySelector("#analyticsExportCsvBtn");
  if (ejBtn) ejBtn.addEventListener("click", () => { const a = document.createElement("a"); a.href = "/api/execution-logs/export?format=json"; a.download = "dplt_logs.json"; a.click(); });
  if (ecBtn) ecBtn.addEventListener("click", () => { const a = document.createElement("a"); a.href = "/api/execution-logs/export?format=csv"; a.download = "dplt_logs.csv"; a.click(); });
}

function renderDailyBarChart(daily) {
  if (!daily.length) {
    return `<div class="analytics-chart-section"><div class="chart-title">Daily Overview</div>
      <div class="task-empty-state" style="padding:24px">No daily data yet</div></div>`;
  }

  const maxClicks = Math.max(1, ...daily.map((d) => d.totalRuns));
  const BAR_HEIGHT = 160;

  const bars = daily.map((d) => {
    const clickH  = Math.round((d.commitClicks / maxClicks) * BAR_HEIGHT);
    const timeH   = Math.round((d.timeoutRuns / maxClicks) * BAR_HEIGHT);
    const failH   = Math.round((d.hardFailedRuns / maxClicks) * BAR_HEIGHT);
    const totalH  = Math.max(clickH + timeH + failH, d.totalRuns > 0 ? 4 : 0);

    const shortDate = d.date.slice(5); // MM-DD
    return `
      <div class="bar-column" title="${esc(d.date)} — ${d.totalRuns} runs, ${d.commitClicks} clicks, ${d.timeoutRuns} timeouts, ${d.hardFailedRuns} hard fails">
        <span class="bar-val">${d.commitClicks}</span>
        <div class="bar-stack" style="height:${totalH}px">
          <span class="bar-segment-clicks" style="height:${clickH}px" title="Clicks: ${d.commitClicks}"></span>
          <span class="bar-segment-timeouts" style="height:${timeH}px" title="Timeouts: ${d.timeoutRuns}"></span>
          <span class="bar-segment-fails" style="height:${failH}px" title="Hard Fails: ${d.hardFailedRuns}"></span>
        </div>
        <span class="bar-label">${esc(shortDate)}</span>
      </div>`;
  }).join("");

  return `
    <div class="analytics-chart-section">
      <div class="chart-title">
        <span>Daily Execution Breakdown</span>
        <div style="display:flex;gap:12px;font-size:11px;font-weight:600">
          <span style="color:var(--accent-ok)">■ Clicks</span>
          <span style="color:var(--accent-warn)">■ Timeouts</span>
          <span style="color:var(--accent-fail)">■ Hard Fails</span>
        </div>
      </div>
      <div class="bar-chart-container" style="height:${BAR_HEIGHT + 48}px">
        ${bars}
      </div>
    </div>`;
}

function renderHourlyChart(hourly) {
  if (!hourly || !hourly.length) return "";
  const maxRuns = Math.max(1, ...hourly.map((h) => h.totalRuns));
  const BAR_H = 90;

  const bars = hourly.map((h) => {
    const clickH = Math.round((h.commitClicks / maxRuns) * BAR_H);
    const timeoH = Math.round((h.timeouts / maxRuns) * BAR_H);
    const failH  = Math.round((h.hardFails / maxRuns) * BAR_H);
    const totalH = Math.max(clickH + timeoH + failH, h.totalRuns > 0 ? 3 : 0);
    return `
      <div class="bar-column" title="${h.hour.toString().padStart(2, "0")}:00 — ${h.totalRuns} total, ${h.commitClicks} clicks">
        <div class="bar-stack" style="height:${totalH}px;min-width:18px;max-width:22px">
          <span class="bar-segment-clicks" style="height:${clickH}px"></span>
          <span class="bar-segment-timeouts" style="height:${timeoH}px"></span>
          <span class="bar-segment-fails" style="height:${failH}px"></span>
        </div>
        <span class="bar-label">${h.hour.toString().padStart(2,"0")}</span>
      </div>`;
  }).join("");

  return `
    <div class="analytics-chart-section">
      <div class="chart-title">Hourly Activity Distribution</div>
      <div class="bar-chart-container" style="height:${BAR_H + 40}px;gap:4px">
        ${bars}
      </div>
    </div>`;
}

function renderWorkflowFunnel(steps, total) {
  if (!steps) return "";
  const stages = [
    { key: "entry",     label: "Entry / Navigation" },
    { key: "selection", label: "Target Selection" },
    { key: "commit",    label: "Submit / Click" }
  ];

  const rows = stages.map(({ key, label }) => {
    const s = steps[key] ?? { matched: 0, failed: 0, skipped: 0, total: 0 };
    const rate = s.total > 0 ? Math.round((s.matched / s.total) * 100) : 0;
    const barColor = rate >= 80 ? "var(--accent-ok)" : rate >= 50 ? "var(--accent-warn)" : "var(--accent-fail)";
    return `
      <tr>
        <td style="padding:8px 14px;color:var(--text-primary);font-weight:600">${esc(label)}</td>
        <td style="padding:8px 14px;color:var(--accent-ok)">${s.matched}</td>
        <td style="padding:8px 14px;color:var(--accent-warn)">${s.skipped}</td>
        <td style="padding:8px 14px;color:var(--accent-fail)">${s.failed}</td>
        <td style="padding:8px 14px">${s.total}</td>
        <td style="padding:8px 14px;min-width:140px">
          <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:8px;overflow:hidden">
            <div style="background:${barColor};width:${rate}%;height:100%;transition:width 0.4s ease"></div>
          </div>
          <small style="color:var(--text-muted)">${rate}% success</small>
        </td>
      </tr>`;
  }).join("");

  return `
    <div class="analytics-chart-section">
      <div class="chart-title">Workflow Stage Funnel</div>
      <div class="analytics-table-wrap">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:rgba(255,255,255,0.03);color:var(--text-muted);font-size:11px">
              <th style="padding:8px 14px;text-align:left">Stage</th>
              <th style="padding:8px 14px;text-align:left">Matched</th>
              <th style="padding:8px 14px;text-align:left">Skipped</th>
              <th style="padding:8px 14px;text-align:left">Failed</th>
              <th style="padding:8px 14px;text-align:left">Total</th>
              <th style="padding:8px 14px;text-align:left">Rate</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderProxyTable(proxyStats) {
  if (!proxyStats.length) return "";
  const sorted = [...proxyStats].sort((a, b) => b.total - a.total);

  const rows = sorted.map((p) => {
    const clickRate = p.total > 0 ? Math.round((p.clicks / p.total) * 100) : 0;
    const barColor = clickRate >= 70 ? "var(--accent-ok)" : clickRate >= 40 ? "var(--accent-warn)" : "var(--accent-fail)";
    return `
      <tr>
        <td style="padding:8px 14px;font-family:var(--font-mono);font-size:11px;color:var(--accent-cyan)">${esc(p.proxyRouteId)}</td>
        <td style="padding:8px 14px">${p.total}</td>
        <td style="padding:8px 14px;color:var(--accent-ok)">${p.clicks}</td>
        <td style="padding:8px 14px;color:var(--accent-warn)">${p.timeouts}</td>
        <td style="padding:8px 14px;color:var(--accent-fail)">${p.fails}</td>
        <td style="padding:8px 14px;min-width:120px">
          <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:7px;overflow:hidden">
            <div style="background:${barColor};width:${clickRate}%;height:100%"></div>
          </div>
          <small style="color:var(--text-muted)">${clickRate}%</small>
        </td>
      </tr>`;
  }).join("");

  return `
    <div class="analytics-chart-section">
      <div class="chart-title">Proxy Performance Breakdown</div>
      <div class="analytics-table-wrap">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:rgba(255,255,255,0.03);color:var(--text-muted);font-size:11px">
              <th style="padding:8px 14px;text-align:left">Proxy</th>
              <th style="padding:8px 14px;text-align:left">Total</th>
              <th style="padding:8px 14px;text-align:left">Clicks</th>
              <th style="padding:8px 14px;text-align:left">Timeouts</th>
              <th style="padding:8px 14px;text-align:left">Hard Fails</th>
              <th style="padding:8px 14px;text-align:left">Click Rate</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderDailyTable(daily) {
  if (!daily.length) return "";
  const rows = [...daily].reverse().map((d) => {
    const rateColor = d.effectiveSuccessRate >= 80 ? "var(--accent-ok)" : d.effectiveSuccessRate >= 50 ? "var(--accent-warn)" : "var(--accent-fail)";
    return `
      <tr>
        <td style="padding:7px 14px;font-family:var(--font-mono);font-size:11px">${esc(d.date)}</td>
        <td style="padding:7px 14px">${d.totalRuns}</td>
        <td style="padding:7px 14px;color:var(--accent-ok)">${d.effectiveCompletedRuns}</td>
        <td style="padding:7px 14px;color:var(--accent-ok)">${d.commitClicks}</td>
        <td style="padding:7px 14px;color:var(--accent-warn)">${d.timeoutRuns}</td>
        <td style="padding:7px 14px;color:var(--accent-fail)">${d.hardFailedRuns}</td>
        <td style="padding:7px 14px;color:${rateColor};font-weight:700">${d.effectiveSuccessRate}%</td>
        <td style="padding:7px 14px;color:var(--text-muted)">${d.avgDurationMs ? fmtDuration(d.avgDurationMs) : "—"}</td>
      </tr>`;
  }).join("");

  return `
    <div class="analytics-chart-section">
      <div class="chart-title">Daily Detail Table</div>
      <div class="analytics-table-wrap">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:rgba(255,255,255,0.03);color:var(--text-muted);font-size:11px">
              <th style="padding:7px 14px;text-align:left">Date</th>
              <th style="padding:7px 14px;text-align:left">Total</th>
              <th style="padding:7px 14px;text-align:left">Effective OK</th>
              <th style="padding:7px 14px;text-align:left">Clicks</th>
              <th style="padding:7px 14px;text-align:left">Timeouts</th>
              <th style="padding:7px 14px;text-align:left">Hard Fails</th>
              <th style="padding:7px 14px;text-align:left">Rate</th>
              <th style="padding:7px 14px;text-align:left">Avg Duration</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

