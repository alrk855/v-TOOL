import { config } from "./config.js";
import type { TaskRecord } from "./types.js";

export async function claimTask(): Promise<TaskRecord | null> {
  const response = await fetch(`${config.dashboardApiBase}/api/runner/claim`, {
    method: "POST",
    headers: authHeaders()
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Unable to claim task: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { task: TaskRecord };
  return body.task;
}

export async function updateTaskStatus(taskId: string, status: TaskRecord["status"]) {
  const response = await fetch(`${config.dashboardApiBase}/api/tasks/${taskId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    throw new Error(`Unable to update task status: ${response.status} ${await response.text()}`);
  }
}

export async function logExecution(payload: Record<string, unknown>) {
  const response = await fetch(`${config.dashboardApiBase}/api/execution-logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Unable to log execution: ${response.status} ${await response.text()}`);
  }
}

export async function checkIpUsage(ip: string): Promise<{ ip: string; usageCount: number; maxAllowed: number; exceeded: boolean }> {
  try {
    const response = await fetch(`${config.dashboardApiBase}/api/runner/check-ip-usage?ip=${encodeURIComponent(ip)}`, {
      headers: authHeaders()
    });
    if (!response.ok) return { ip, usageCount: 0, maxAllowed: 6, exceeded: false };
    return (await response.json()) as { ip: string; usageCount: number; maxAllowed: number; exceeded: boolean };
  } catch {
    return { ip, usageCount: 0, maxAllowed: 6, exceeded: false };
  }
}

export async function rescheduleTask(taskId: string, delayMinutes: number = 20): Promise<void> {
  const response = await fetch(`${config.dashboardApiBase}/api/runner/reschedule-task`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ taskId, delayMinutes })
  });

  if (!response.ok) {
    console.warn(`Unable to reschedule task ${taskId}: ${response.status}`);
  }
}

function authHeaders(): Record<string, string> {
  return config.runnerApiToken ? { Authorization: `Bearer ${config.runnerApiToken}` } : {};
}
