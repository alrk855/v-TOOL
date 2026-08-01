import pLimit from "p-limit";
import {
  chromium,
  request,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page
} from "playwright";
import { pickFootprint } from "./agentProfiles.js";
import { config } from "./config.js";
import { checkIpUsage, logExecution, rescheduleTask, updateTaskStatus } from "./dashboardClient.js";
import type { AgentFootprint, ProxyRoute, TaskRecord, WorkflowConfig } from "./types.js";

class CriticalIsolationError extends Error {
  constructor(message: string, readonly metadata: Record<string, unknown>) {
    super(message);
    this.name = "CriticalIsolationError";
  }
}

export async function executeTask(task: TaskRecord) {
  const concurrency = Math.min(config.runnerConcurrency, task.maxParallelThreads);
  const limit = pLimit(concurrency);
  const spacingMs = calculateSpacingMs(task);

  if (config.devMode) {
    console.log("[DEV MODE] Running with visible browser — proxy isolation check is DISABLED.");
  }

  let browser: Browser | null = null;
  const isCdp = !!config.chromeCdpEndpoint;
  let cdpConnected = false; // tracks if CDP actually succeeded (vs fallback launch)

  try {
    if (isCdp) {
      try {
        console.log(`[CDP MODE] Connecting to active Chrome instance at ${config.chromeCdpEndpoint}`);
        browser = await chromium.connectOverCDP(config.chromeCdpEndpoint!);
        cdpConnected = true;
        console.log(`[CDP MODE] Connected successfully.`);
      } catch (cdpErr) {
        console.warn(`[CDP MODE] Connection failed (${cdpErr instanceof Error ? cdpErr.message.split("\n")[0] : cdpErr}). Falling back to Playwright launch.`);
        browser = await chromium.launch({
          headless: config.headless,
          slowMo: config.devMode ? 250 : 0,
          ignoreDefaultArgs: ["--enable-automation"],
          args: [
            "--disable-blink-features=AutomationControlled",
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--webrtc-ip-handling-policy=disable_non_proxied_udp"
          ]
        });
      }
    } else {
      browser = await chromium.launch({
        headless: config.headless,
        slowMo: config.devMode ? 250 : 0,
        ignoreDefaultArgs: ["--enable-automation"],
        args: [
          "--disable-blink-features=AutomationControlled",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--webrtc-ip-handling-policy=disable_non_proxied_udp"
        ]
      });
    }

    const results = await Promise.allSettled(
      Array.from({ length: task.totalExecutions }, (_, index) =>
        limit(async () => {
          if (spacingMs > 0) {
            await delay(withJitter(index * spacingMs, 0.3));
          }
          return await executeThread(task, index, browser!, cdpConnected);
        })
      )
    );

    const threadOutputs = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    const wasRescheduled = threadOutputs.some((out) => out?.rescheduled === true);

    if (!wasRescheduled) {
      const failed = results.filter((result) => result.status === "rejected").length;
      await updateTaskStatus(task.id, failed === task.totalExecutions ? "failed" : "completed");
    }
  } catch (error) {
    console.error(`executeTask launch/connection failed for task ${task.id}:`, error);
    await updateTaskStatus(task.id, "failed");
    await logExecution({
      taskId: task.id,
      threadId: "system",
      statusCode: "failed",
      message: error instanceof Error ? error.message : String(error),
      userAgent: "system-agent",
      locale: task.locales[0] ?? "en-US",
      region: task.regions[0] ?? "US",
      viewportWidth: 1024,
      viewportHeight: 768,
      deviceScaleFactor: 1,
      proxyRouteId: task.proxyRouteId ?? "none",
      durationMs: 0,
      metadata: { error: error instanceof Error ? error.stack : String(error) }
    }).catch(console.error);
    throw error;
  } finally {
    // Only skip close if CDP actually connected — if we fell back to a Playwright launch we must close it
    if (browser && !cdpConnected) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error("browser.close() failed:", closeError);
      }
    }
  }
}

async function executeThread(task: TaskRecord, index: number, browser: Browser, isCdp: boolean) {
  const profileIndex = task.agentProfileIndex ?? index;
  const footprint = pickFootprint(profileIndex);
  const locale = task.locales[index % task.locales.length] ?? "en-US";
  const region = task.regions[index % task.regions.length] ?? "US";

  // Prefer task-embedded proxy definition; fall back to global config pool.
  // In DEV_MODE with no proxies configured, use a bare direct-connection stub.
  const proxyRoute: ProxyRoute =
    task.proxy ??
    config.proxyRoutes.find((route) => route.id === task.proxyRouteId) ??
    config.proxyRoutes[index % Math.max(1, config.proxyRoutes.length)] ??
    { id: "dev-direct" };

  // Prefer task-embedded workflow; fall back to global config
  const taskWorkflow: WorkflowConfig = { ...config.workflow, ...task.workflow };

  const threadId = `${task.id.slice(0, 8)}-${index + 1}`;
  const started = Date.now();

  const context = isCdp
    ? (browser.contexts()[0] ?? await browser.newContext(buildContextOptions(footprint, locale, region, proxyRoute)))
    : await browser.newContext(buildContextOptions(footprint, locale, region, proxyRoute));

  let page: Page | null = null;
  try {
    if (!isCdp) {
      await context.clearCookies();
      await context.clearPermissions();
    }

    const isolation = isCdp
      ? { hostIp: "cdp-real-chrome", routedIp: "cdp-real-chrome" }
      : await verifyNetworkIsolation(context, proxyRoute);

    // IP Overuse Guard: Check if exit IP has been used >= 6 times already
    if (
      isolation.routedIp &&
      isolation.routedIp !== "dev-local" &&
      isolation.routedIp !== "cdp-real-chrome" &&
      !isolation.routedIp.startsWith("cdp-")
    ) {
      const ipCheck = await checkIpUsage(isolation.routedIp);
      if (ipCheck.exceeded) {
        console.warn(
          `[IP OVERUSE GUARD] Exit IP ${isolation.routedIp} has been used ${ipCheck.usageCount} times (limit 6). Rescheduling task ${task.id} for later.`
        );

        await logExecution({
          taskId: task.id,
          threadId,
          statusCode: "rescheduled",
          message: `Exit IP ${isolation.routedIp} used ${ipCheck.usageCount} times (limit 6). Task rescheduled for later.`,
          userAgent: footprint.userAgent,
          locale,
          region,
          timezoneId: footprint.timezoneId,
          viewportWidth: footprint.viewport.width,
          viewportHeight: footprint.viewport.height,
          deviceScaleFactor: footprint.deviceScaleFactor,
          proxyRouteId: proxyRoute.id,
          durationMs: Date.now() - started,
          metadata: {
            ipOverused: true,
            exitIp: isolation.routedIp,
            usageCount: ipCheck.usageCount,
            maxAllowed: ipCheck.maxAllowed
          }
        });

        // Reschedule task 15 to 30 minutes into the future
        const delayMins = Math.floor(15 + Math.random() * 15);
        await rescheduleTask(task.id, delayMins);
        return { rescheduled: true, reason: "ip_overused" };
      }
    }

    const localization = isCdp
      ? { language: locale, timezone: footprint.timezoneId }
      : await verifyContextLocalization(context, footprint, locale);

    page = await context.newPage();

    await installPrivacyPreservingInitScript(page, footprint);
    await humanDelay(600, 1400);

    const response = await page.goto(task.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    const graphicsAudit = await auditGraphicsPipeline(page, footprint);
    await humanDelay(3000, 7000);
    await page.mouse.move(randomInt(40, footprint.viewport.width - 40), randomInt(40, footprint.viewport.height - 40), {
      steps: randomInt(6, 18)
    });
    await page.mouse.wheel(0, randomInt(180, 620));
    await humanDelay(900, 2600);
    const workflow = await runTargetWorkflow(page, taskWorkflow);

    const screenshotBase64 = config.screenshotsEnabled
      ? await page.screenshot({ type: "jpeg", quality: 70 })
          .then((buf) => buf.toString("base64"))
          .catch(() => null)
      : null;

    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    await logExecution({
      taskId: task.id,
      threadId,
      statusCode: "completed",
      message: `HTTP ${response?.status() ?? "no-response"}`,
      userAgent: footprint.userAgent,
      locale,
      region,
      timezoneId: footprint.timezoneId,
      viewportWidth: footprint.viewport.width,
      viewportHeight: footprint.viewport.height,
      deviceScaleFactor: footprint.deviceScaleFactor,
      proxyRouteId: proxyRoute.id,
      durationMs: Date.now() - started,
      metadata: {
        agentProfile: footprint.name,
        hostIp: isolation.hostIp,
        routedIp: isolation.routedIp,
        localization,
        graphicsAudit,
        workflow,
        responseStatus: response?.status() ?? null,
        finalUrl: page.url(),
        title: await page.title().catch(() => null),
        screenshotBase64
      }
    });
  } catch (error) {
    await logExecution({
      taskId: task.id,
      threadId,
      statusCode: "failed",
      message: error instanceof Error ? error.message : String(error),
      userAgent: footprint.userAgent,
      locale,
      region,
      timezoneId: footprint.timezoneId,
      viewportWidth: footprint.viewport.width,
      viewportHeight: footprint.viewport.height,
      deviceScaleFactor: footprint.deviceScaleFactor,
      proxyRouteId: proxyRoute.id,
      durationMs: Date.now() - started,
      metadata: {
        index,
        critical: error instanceof CriticalIsolationError,
        details: error instanceof CriticalIsolationError ? error.metadata : undefined
      }
    });
    throw error;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (closeError) {
        console.error("page.close() failed:", closeError);
      }
    }
    if (!isCdp && context) {
      try {
        await context.close();
      } catch (closeError) {
        console.error("context.close() failed:", closeError);
      }
    }
  }
}

function buildContextOptions(
  footprint: AgentFootprint,
  locale: string,
  region: string,
  proxyRoute: ProxyRoute
): BrowserContextOptions {
  return {
    userAgent: footprint.userAgent,
    viewport: footprint.viewport,
    deviceScaleFactor: footprint.deviceScaleFactor,
    locale,
    timezoneId: footprint.timezoneId,
    isMobile: footprint.isMobile,
    hasTouch: footprint.hasTouch,
    proxy: toPlaywrightProxy(proxyRoute),
    extraHTTPHeaders: {
      "Accept-Language": locale,
      "X-Synthetic-Region": region,
      "X-Proxy-Route-Id": proxyRoute.id
    }
  };
}

async function verifyNetworkIsolation(context: BrowserContext, proxyRoute: ProxyRoute) {
  // In dev mode, skip the proxy isolation check entirely so local testing works without real proxies.
  if (config.devMode) {
    console.log(`[DEV MODE] Skipping network isolation check for route: ${proxyRoute.id}`);
    return { hostIp: "dev-local", routedIp: "dev-local" };
  }

  if (!proxyRoute.server) {
    throw new CriticalIsolationError("No proxy server configured for route; refusing to contact target URL.", {
      proxyRouteId: proxyRoute.id
    });
  }

  const [hostIp, routedIp] = await Promise.all([lookupHostIp(), lookupContextIp(context)]);

  if (hostIp && routedIp && hostIp === routedIp) {
    throw new CriticalIsolationError("Proxy route leaked host IP; refusing to contact target URL.", {
      proxyRouteId: proxyRoute.id,
      hostIp,
      routedIp
    });
  }

  return { hostIp, routedIp };
}

async function lookupHostIp() {
  const diagnostic = await request.newContext({ timeout: 15000 });
  try {
    return await fetchDiagnosticIp(diagnostic);
  } finally {
    await diagnostic.dispose();
  }
}

async function lookupContextIp(context: BrowserContext) {
  return fetchDiagnosticIp(context.request);
}

async function fetchDiagnosticIp(api: APIRequestContext) {
  const response = await api.get(config.diagnosticEndpoint, { timeout: 15000 });
  if (!response.ok()) {
    throw new CriticalIsolationError("Diagnostic IP lookup failed; refusing to contact target URL.", {
      endpoint: config.diagnosticEndpoint,
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

async function verifyContextLocalization(
  context: BrowserContext,
  footprint: AgentFootprint,
  expectedLocale: string
) {
  const page = await context.newPage();
  try {
    const actual = await page.evaluate(() => ({
      language: navigator.language,
      languages: navigator.languages,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio
      },
      touchPoints: navigator.maxTouchPoints
    }));

    if (actual.language !== expectedLocale) {
      throw new CriticalIsolationError("Locale preflight mismatch; refusing to contact target URL.", {
        expectedLocale,
        actualLocale: actual.language
      });
    }

    if (actual.timezone !== footprint.timezoneId) {
      throw new CriticalIsolationError("Timezone preflight mismatch; refusing to contact target URL.", {
        expectedTimezone: footprint.timezoneId,
        actualTimezone: actual.timezone
      });
    }

    return actual;
  } finally {
    await page.close();
  }
}

async function installPrivacyPreservingInitScript(page: Page, footprint: AgentFootprint) {
  await page.addInitScript((footprintParam) => {
    const clearTransientStorage = () => {
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        // Some pages disable storage access. The context itself remains isolated.
      }
    };

    clearTransientStorage();
    window.addEventListener("pagehide", clearTransientStorage);

    try {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    } catch {
      // Some browsers lock down navigator.webdriver; ignore if redefining fails.
    }

    try {
      // Mock basic hardware/OS specs
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
      Object.defineProperty(navigator, "platform", {
        get: () => footprintParam.userAgent.includes("Macintosh") ? "MacIntel" : "Win32"
      });
    } catch {
      // Ignore if properties are readonly
    }

    // Mock window.chrome object to bypass anti-bot detections
    try {
      if (!(window as any).chrome) {
        Object.defineProperty(window, "chrome", {
          value: {
            app: {
              isInstalled: false,
              InstallState: { DISABLED: "Disabled", INSTALLED: "Installed", NOT_INSTALLED: "NotInstalled" },
              RunningState: { CANNOT_RUN: "CannotRun", RUNNING: "Running", SUGGEST_PROMOTION: "SuggestPromotion" },
              getDetails: () => null,
              getIsInstalled: () => false,
              install: () => {}
            },
            runtime: {
              OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", SHARED_MODULE_UPDATE: "shared_module_update", UPDATE: "update" },
              OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
              PlatformArch: { ARM: "arm", ARM64: "arm64", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
              PlatformNaclArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
              PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
              RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" }
            },
            loadTimes: () => ({}),
            csi: () => ({})
          },
          configurable: true,
          enumerable: true,
          writable: true
        });
      }
    } catch (e) {}

    // Mock navigator.plugins and navigator.mimeTypes
    try {
      if (navigator.plugins.length === 0) {
        const mockPlugin = Object.create(Plugin.prototype, {
          name: { value: "Chrome PDF Viewer" },
          description: { value: "Portable Document Format" },
          filename: { value: "internal-pdf-viewer" },
          length: { value: 1 }
        });
        const mockMimeType = Object.create(MimeType.prototype, {
          type: { value: "application/pdf" },
          description: { value: "Portable Document Format" },
          suffixes: { value: "pdf" },
          enabledPlugin: { value: mockPlugin }
        });
        mockPlugin[0] = mockMimeType;
        
        Object.defineProperty(navigator, "plugins", {
          get: () => [mockPlugin]
        });
        Object.defineProperty(navigator, "mimeTypes", {
          get: () => [mockMimeType]
        });
      }
    } catch (e) {}

    // Mock permissions query consistency
    try {
      const originalQuery = navigator.permissions.query;
      navigator.permissions.query = (parameters) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: "denied", onchange: null } as PermissionStatus)
          : originalQuery(parameters);
    } catch (e) {}

    try {
      // Align screen layout configurations with spoofed viewport
      const width = footprintParam.viewport.width;
      const height = footprintParam.viewport.height;
      const screenSpecs = {
        width,
        height,
        availWidth: width,
        availHeight: height,
        colorDepth: 24,
        pixelDepth: 24
      };

      for (const [key, value] of Object.entries(screenSpecs)) {
        Object.defineProperty(window.Screen.prototype, key, {
          get: () => value,
          configurable: true
        });
      }
    } catch {
      // Ignore screen override issues
    }

    try {
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (
        this: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number
      ) {
        const imageData = originalGetImageData.apply(this, arguments as unknown as [number, number, number, number]);

        if (imageData.data.length > 0) {
          imageData.data[0] = (imageData.data[0] + 1) % 256;
        }

        return imageData;
      };
    } catch {
      // Canvas APIs may be unavailable in some environments.
    }

    const evaluateWebGL = (glProto: any) => {
      if (!glProto) {
        return;
      }

      const originalGetParameter = glProto.getParameter;
      glProto.getParameter = function (parameter: number) {
        if (parameter === 37445) {
          return "Google Inc. (NVIDIA)";
        }

        if (parameter === 37446) {
          const gpus = [
            "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU, OpenGL 4.5)",
            "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU, OpenGL 4.5)",
            "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.5)"
          ];

          return gpus[Math.floor(Math.random() * gpus.length)];
        }

        return originalGetParameter.apply(this, arguments);
      };
    };

    try {
      if (window.WebGLRenderingContext) {
        evaluateWebGL(window.WebGLRenderingContext.prototype);
      }
      if (window.WebGL2RenderingContext) {
        evaluateWebGL(window.WebGL2RenderingContext.prototype);
      }
    } catch {
      // Ignore environments where WebGL contexts cannot be created or mocked.
    }
  }, footprint);
}

async function auditGraphicsPipeline(page: Page, footprint: AgentFootprint) {
  const observed = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context2d = canvas.getContext("2d");

    if (context2d) {
      context2d.textBaseline = "top";
      context2d.font = "16px Arial";
      context2d.fillStyle = "#172033";
      context2d.fillRect(0, 0, 64, 64);
      context2d.fillStyle = "#f5f7fb";
      context2d.fillText("DPLT", 4, 8);
    }

    const webglCanvas = document.createElement("canvas");
    const gl =
      webglCanvas.getContext("webgl") ||
      webglCanvas.getContext("experimental-webgl") ||
      webglCanvas.getContext("webgl2");

    let vendor: string | null = null;
    let renderer: string | null = null;
    let unmaskedVendor: string | null = null;
    let unmaskedRenderer: string | null = null;

    if (gl && "getParameter" in gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      vendor = String(gl.getParameter(gl.VENDOR));
      renderer = String(gl.getParameter(gl.RENDERER));

      if (debugInfo) {
        unmaskedVendor = String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
        unmaskedRenderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
      }
    }

    return {
      canvasSampleHash: hashString(canvas.toDataURL("image/png")),
      webgl: {
        vendor,
        renderer,
        unmaskedVendor,
        unmaskedRenderer
      }
    };

    function hashString(value: string) {
      let hash = 0;
      for (let index = 0; index < value.length; index += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(index);
        hash |= 0;
      }
      return hash.toString(16);
    }
  });

  const joinedGraphicsText = [
    observed.webgl.vendor,
    observed.webgl.renderer,
    observed.webgl.unmaskedVendor,
    observed.webgl.unmaskedRenderer
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    expected: footprint.expectedGraphics,
    observed,
    matchesExpectedFamily: footprint.expectedGraphics.expectedRendererPatterns.some((pattern) =>
      joinedGraphicsText.includes(pattern)
    )
  };
}

async function runTargetWorkflow(page: Page, workflow: WorkflowConfig) {
  const entrySelector = workflow.entrySelector ?? workflow.surveyOptionSelector;
  const targetAssetSelector = workflow.targetAssetSelector ?? workflow.surveyOptionSelector;
  // Only check selection state if the user explicitly set a selector — no hardcoded fallback
  const selectionStateSelector = workflow.selectionStateSelector;
  const finalActionSelector = workflow.finalActionSelector ?? workflow.confirmationSelector;
  const finalActionTexts = workflow.finalActionTexts ?? workflow.confirmationTexts ?? [];

  // Each stage is skipped gracefully when no selector/text is configured
  const entry = await clickConfiguredStage(page, {
    selector: entrySelector,
    texts: [],
    timeoutMs: 8000,
    postClickDelay: [1500, 3500],
    label: "entry"
  });

  const selection = await clickConfiguredStage(page, {
    selector: targetAssetSelector,
    texts: [],
    timeoutMs: 8000,
    postClickDelay: [2000, 4000],
    label: "target"
  });

  if (selectionStateSelector) {
    try {
      await expectVisible(page.locator(selectionStateSelector).first(), 5000, "selection state");
    } catch {
      console.warn(`[workflow] selection state selector not found: ${selectionStateSelector} — continuing`);
    }
  }

  const commit = await clickConfiguredStage(page, {
    selector: finalActionSelector,
    texts: finalActionTexts,
    timeoutMs: 8000,
    postClickDelay: [3000, 5000],
    label: "commit"
  });

  return { entry, selection, commit };
}

async function clickConfiguredStage(
  page: Page,
  options: {
    selector?: string;
    texts?: string[];
    timeoutMs: number;
    postClickDelay: [number, number];
    label: string;
  }
) {
  // If neither a selector nor any texts were given, skip this stage entirely
  const hasSelector = !!options.selector?.trim();
  const hasTexts = (options.texts ?? []).length > 0;

  if (!hasSelector && !hasTexts) {
    console.log(`[workflow] stage "${options.label}" skipped — no selector or text configured`);
    return { matched: false, strategy: "skipped", value: null };
  }

  try {
    const locator = await resolveStageLocator(page, options.selector, options.texts ?? [], options.timeoutMs, options.label);
    await locator.click({ timeout: options.timeoutMs });
    await humanDelay(options.postClickDelay[0], options.postClickDelay[1]);
    return {
      matched: true,
      strategy: options.selector ? "selector" : "text",
      value: options.selector ?? options.texts?.[0] ?? null
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[workflow] stage "${options.label}" failed: ${msg}`);
    return { matched: false, strategy: "failed", value: msg };
  }
}

async function resolveStageLocator(
  page: Page,
  selector: string | undefined,
  texts: string[],
  timeoutMs: number,
  label: string
) {
  if (selector?.trim()) {
    const locator = page.locator(selector).first();
    await expectVisible(locator, timeoutMs, label);
    await locator.scrollIntoViewIfNeeded();
    return locator;
  }

  for (const text of texts) {
    const locator = page.getByText(text, { exact: false }).first();
    try {
      await expectVisible(locator, timeoutMs, label);
      await locator.scrollIntoViewIfNeeded();
      return locator;
    } catch {
      // Try the next text heuristic.
    }
  }

  // Use a plain Error (not CriticalIsolationError) so task fails gracefully
  throw new Error(`Workflow ${label} stage: no selector/text matched within ${timeoutMs}ms. selector=${selector}, texts=[${texts.join(",")}]`);
}

async function expectVisible(locator: ReturnType<Page["locator"]>, timeoutMs: number, label: string) {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    throw new CriticalIsolationError(`Workflow ${label} stage timed out after ${timeoutMs}ms.`, {
      label,
      timeoutMs
    });
  }
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

function calculateSpacingMs(task: TaskRecord) {
  if (task.distributionHours <= 0 || task.totalExecutions <= 1) {
    return 0;
  }

  return Math.floor((task.distributionHours * 60 * 60 * 1000) / task.totalExecutions);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function humanDelay(minMs: number, maxMs: number) {
  return delay(randomInt(minMs, maxMs));
}

function withJitter(value: number, ratio: number) {
  const drift = value * ratio;
  return Math.max(0, Math.floor(value - drift + Math.random() * drift * 2));
}

function randomInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function normalizeIp(value: string | undefined) {
  return value?.trim().replace(/^::ffff:/, "") ?? null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
