import type { ProxyRoute } from "./types.js";

const defaultProxyRoutes: ProxyRoute[] = [
  { id: "direct-us-east" },
  { id: "direct-eu-west" },
  { id: "direct-apac" }
];

const _devMode = process.env.DEV_MODE === "true" || (process.env.DEV_MODE !== "false" && !process.env.PROXY_ROUTES_JSON);

export const config = {
  dashboardApiBase: process.env.DASHBOARD_API_BASE ?? "http://localhost:3000",
  runnerApiToken: process.env.RUNNER_API_TOKEN,
  runnerConcurrency: Number(process.env.RUNNER_CONCURRENCY ?? 4),
  pollIntervalMs: Number(process.env.RUNNER_POLL_INTERVAL_MS ?? 2500),
  diagnosticEndpoint: process.env.DIAGNOSTIC_ENDPOINT ?? "https://api.ipify.org?format=json",
  proxyRoutes: parseProxyRoutes(process.env.PROXY_ROUTES_JSON),
  /** DEV_MODE=true → visible browser, skip proxy isolation check. Defaults to true if no proxy routes are configured. */
  devMode: _devMode,
  /** HEADLESS=false → show browser window. Auto-false in devMode (no proxies configured = visible by default). */
  headless: process.env.HEADLESS !== "false" && !_devMode,
  /** Optional Chrome DevTools Protocol endpoint (e.g. http://localhost:9222) to connect to a running Chrome instance. */
  chromeCdpEndpoint: process.env.CHROME_CDP_ENDPOINT
    ? process.env.CHROME_CDP_ENDPOINT.replace("localhost", "127.0.0.1")
    : null,
  screenshotsEnabled: process.env.SCREENSHOTS_ENABLED !== "false",
  workflow: {
    surveyOptionText: process.env.SURVEY_OPTION_TEXT,
    surveyOptionSelector: process.env.SURVEY_OPTION_SELECTOR,
    confirmationTexts: parseTextList(process.env.CONFIRMATION_TEXTS, ["Vote", "Submit", "Гласај"]),
    confirmationSelector: process.env.CONFIRMATION_SELECTOR
  }
};

function parseProxyRoutes(value: string | undefined): ProxyRoute[] {
  if (!value) {
    // No proxy configured — return empty array.
    // In DEV_MODE the isolation check is skipped so this is safe.
    return [];
  }

  const parsed = JSON.parse(value) as ProxyRoute[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("PROXY_ROUTES_JSON must be a non-empty JSON array");
  }

  return parsed.map((route) => {
    if (!route.id) {
      throw new Error("Every proxy route requires an id");
    }
    return route;
  });
}

function parseTextList(value: string | undefined, fallback: string[]) {
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
