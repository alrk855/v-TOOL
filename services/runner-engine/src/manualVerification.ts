import { chromium, request, type BrowserContextOptions } from "playwright";

type ProxyRoute = {
  id: string;
  server?: string;
  username?: string;
  password?: string;
};

class CriticalIsolationError extends Error {
  constructor(message: string, readonly metadata: Record<string, unknown>) {
    super(message);
    this.name = "CriticalIsolationError";
  }
}

const diagnosticEndpoint = process.env.DIAGNOSTIC_ENDPOINT ?? "https://api.ipify.org?format=json";
const targetUrl = process.env.VERIFICATION_TARGET_URL ?? "https://httpbin.org/ip";
const verificationMode = process.env.VERIFICATION_MODE ?? "all";
const proxyRoutes = parseProxyRoutes(process.env.PROXY_ROUTES_JSON);
const brokenProxyRoute: ProxyRoute = {
  id: "broken-proxy",
  server: process.env.BROKEN_PROXY_SERVER ?? "http://127.0.0.1:9999"
};

const browserArgs = [
  "--disable-blink-features=AutomationControlled",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--webrtc-ip-handling-policy=disable_non_proxied_udp"
];

async function main() {
  console.log("verification:start", {
    verificationMode,
    diagnosticEndpoint,
    targetUrl,
    proxyRoutes: proxyRoutes.map(({ id, server }) => ({ id, server }))
  });

  if (verificationMode !== "fail-closed") {
    const hostIp = await lookupHostIp();
    console.log("verification:host-ip", hostIp);

    const successRoute = proxyRoutes.find((route) => route.server) ?? proxyRoutes[0];
    if (!successRoute) {
      throw new Error("No proxy route configured for success-path verification.");
    }

    const routedIp = await lookupContextIp(successRoute);
    console.log("verification:routed-ip", routedIp);
    console.log("verification:mismatch", hostIp !== null && routedIp !== null ? hostIp !== routedIp : "unknown");

    const successPage = await runSingleTextExecution(successRoute);
    console.log("verification:success-path", {
      finalUrl: successPage.finalUrl,
      bodyPreview: successPage.bodyPreview
    });
  }

  if (verificationMode !== "success") {
    const failClosed = await assertFailClosed(brokenProxyRoute);
    if (!failClosed) {
      throw new Error("Fail-closed verification did not trigger as expected.");
    }
    console.log("verification:fail-closed", "CriticalIsolationError captured before target navigation");
  }
}

async function lookupHostIp() {
  const diagnostic = await request.newContext({ timeout: 15000 });
  try {
    return await fetchDiagnosticIp(diagnostic);
  } finally {
    await diagnostic.dispose();
  }
}

async function lookupContextIp(proxyRoute: ProxyRoute) {
  const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--enable-automation"], args: browserArgs });
  try {
    const context = await browser.newContext({ proxy: toPlaywrightProxy(proxyRoute) });
    try {
      return await fetchDiagnosticIp(context.request);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function runSingleTextExecution(proxyRoute: ProxyRoute) {
  const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--enable-automation"], args: browserArgs });
  try {
    const context = await browser.newContext({ proxy: toPlaywrightProxy(proxyRoute) });
    const page = await context.newPage();
    try {
      const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      const bodyPreview = (await page.textContent("body"))?.trim().slice(0, 200) ?? "";
      return {
        finalUrl: page.url(),
        status: response?.status() ?? null,
        bodyPreview
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function assertFailClosed(proxyRoute: ProxyRoute) {
  const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--enable-automation"], args: browserArgs });
  try {
    const context = await browser.newContext({ proxy: toPlaywrightProxy(proxyRoute) });
    try {
      await fetchDiagnosticIp(context.request);
      return false;
    } catch (error) {
      if (error instanceof CriticalIsolationError) {
        return true;
      }

      if (error instanceof Error && /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH/i.test(error.message)) {
        return true;
      }

      throw new CriticalIsolationError("Proxy route failed before target navigation.", {
        proxyRouteId: proxyRoute.id,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function fetchDiagnosticIp(api: { get(url: string, options?: { timeout?: number }): Promise<any> }) {
  const response = await api.get(diagnosticEndpoint, { timeout: 15000 });
  if (!response.ok()) {
    throw new CriticalIsolationError("Diagnostic IP lookup failed; refusing to continue.", {
      endpoint: diagnosticEndpoint,
      status: response.status()
    });
  }

  const contentType = response.headers()["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json()) as { ip?: string };
    return normalizeIp(body.ip);
  }

  return normalizeIp(await response.text());
}

function parseProxyRoutes(value: string | undefined): ProxyRoute[] {
  if (!value) {
    return [
      { id: "sample-http", server: "http://127.0.0.1:3128" },
      { id: "sample-socks5", server: "socks5://127.0.0.1:1080" }
    ];
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

function toPlaywrightProxy(proxyRoute: ProxyRoute): BrowserContextOptions["proxy"] {
  if (!proxyRoute.server) {
    return undefined;
  }

  return {
    server: proxyRoute.server,
    username: proxyRoute.username,
    password: proxyRoute.password
  };
}

function normalizeIp(value: string | undefined) {
  return value?.trim().replace(/^::ffff:/, "") ?? null;
}

main().catch((error) => {
  if (error instanceof CriticalIsolationError) {
    console.error(error.name, error.message, error.metadata);
    process.exitCode = 1;
    return;
  }

  console.error(error);
  process.exitCode = 1;
});