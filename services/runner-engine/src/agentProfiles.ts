import type { AgentFootprint } from "./types.js";

export const agentFootprints: AgentFootprint[] = [
  {
    name: "desktop-chromium-windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    timezoneId: "America/New_York",
    isMobile: false,
    hasTouch: false,
    expectedGraphics: {
      vendorFamily: "nvidia",
      auditLabel: "NVIDIA GeForce laptop class",
      expectedRendererPatterns: ["nvidia", "geforce", "angle"]
    }
  },
  {
    name: "desktop-webkit-macos",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    timezoneId: "Europe/Berlin",
    isMobile: false,
    hasTouch: false,
    expectedGraphics: {
      vendorFamily: "apple",
      auditLabel: "Apple M-series integrated GPU class",
      expectedRendererPatterns: ["apple", "m1", "m2", "m3", "m4", "metal"]
    }
  },
  {
    name: "mobile-chromium-android",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    timezoneId: "Asia/Tokyo",
    isMobile: true,
    hasTouch: true,
    expectedGraphics: {
      vendorFamily: "qualcomm",
      auditLabel: "Qualcomm Adreno mobile GPU class",
      expectedRendererPatterns: ["qualcomm", "adreno", "angle"]
    }
  },
  {
    name: "desktop-chromium-mk",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    timezoneId: "Europe/Skopje",
    isMobile: false,
    hasTouch: false,
    expectedGraphics: {
      vendorFamily: "nvidia",
      auditLabel: "NVIDIA GeForce laptop class",
      expectedRendererPatterns: ["nvidia", "geforce", "angle"]
    }
  }
];

export function pickFootprint(index: number) {
  return agentFootprints[index % agentFootprints.length];
}
