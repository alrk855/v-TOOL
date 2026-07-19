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

function authHeaders(): Record<string, string> {
  return config.runnerApiToken ? { Authorization: `Bearer ${config.runnerApiToken}` } : {};
}
