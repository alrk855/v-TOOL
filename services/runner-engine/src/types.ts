export interface TaskRecord {
  id: string;
  targetUrl: string;
  totalExecutions: number;
  distributionHours: number;
  locales: string[];
  regions: string[];
  maxParallelThreads: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  completedExecutions: number;
  failedExecutions: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  scheduledAt?: string | null;
  dispatchIndex?: number | null;
  agentProfileIndex?: number | null;
  proxyRouteId?: string | null;
  batchId?: string | null;
  /** Task-embedded proxy definition (overrides global pool lookup). */
  proxy?: ProxyRoute | null;
  /** Task-embedded workflow click config (overrides global env config). */
  workflow?: Partial<WorkflowConfig> | null;
}

export interface AgentFootprint {
  name: string;
  userAgent: string;
  viewport: {
    width: number;
    height: number;
  };
  deviceScaleFactor: number;
  timezoneId: string;
  isMobile: boolean;
  hasTouch: boolean;
  expectedGraphics: GraphicsPipelineProfile;
}

export interface ProxyRoute {
  id: string;
  server?: string;
  username?: string;
  password?: string;
}

export interface GraphicsPipelineProfile {
  vendorFamily: "apple" | "intel" | "nvidia" | "qualcomm";
  expectedRendererPatterns: string[];
  auditLabel: string;
}

export interface WorkflowConfig {
  surveyOptionText?: string;
  surveyOptionSelector?: string;
  confirmationTexts: string[];
  confirmationSelector?: string;
  entrySelector?: string;
  targetAssetSelector?: string;
  selectionStateSelector?: string;
  finalActionSelector?: string;
  finalActionTexts?: string[];
}
