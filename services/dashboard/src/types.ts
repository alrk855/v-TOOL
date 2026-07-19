export type TaskStatus = "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ProxyRouteDefinition {
  id: string;
  server?: string;
  username?: string;
  password?: string;
  /** Maximum number of times this proxy may be used across all tasks (1-based). */
  maxUsages?: number;
}

export interface WorkflowDefinition {
  /** CSS selector or text label for the entry/initial click. */
  entrySelector?: string;
  /** CSS selector or text label for the target element to select. */
  targetAssetSelector?: string;
  /** CSS selector for confirming a selected state is active. */
  selectionStateSelector?: string;
  /** CSS selector for the final submit/confirm action. */
  finalActionSelector?: string;
  /** Array of text labels to try for the final submit action. */
  finalActionTexts?: string[];
}

export interface CreateTaskInput {
  targetUrl: string;
  totalExecutions: number;
  distributionHours: number;
  locales: string[];
  regions: string[];
  maxParallelThreads: number;
  status?: TaskStatus;
  scheduledAt?: string | null;
  dispatchIndex?: number | null;
  agentProfileIndex?: number | null;
  proxyRouteId?: string | null;
  /** Active-hour window start (0-23, local to the runner timezone). */
  activeHoursStart?: number | null;
  /** Active-hour window end (0-23, exclusive). */
  activeHoursEnd?: number | null;
  workflow?: WorkflowDefinition | null;
  proxy?: ProxyRouteDefinition | null;
}

export interface TaskRecord extends CreateTaskInput {
  id: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  completedExecutions: number;
  failedExecutions: number;
  scheduledAt: string | null;
  dispatchIndex: number | null;
  agentProfileIndex: number | null;
  proxyRouteId: string | null;
}

export interface ExecutionLogInput {
  taskId: string;
  threadId: string;
  statusCode: string;
  message?: string;
  userAgent: string;
  locale: string;
  region: string;
  timezoneId?: string;
  viewportWidth: number;
  viewportHeight: number;
  deviceScaleFactor: number;
  proxyRouteId: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}
