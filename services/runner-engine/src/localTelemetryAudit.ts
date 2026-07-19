import { chromium } from "playwright";

const auditUrl = process.env.AUDIT_URL ?? "http://localhost:3000/diagnostics/audit";

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(auditUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => Boolean((window as Window & { __auditSnapshot?: unknown }).__auditSnapshot), null, {
      timeout: 15000
    });

    const snapshot = await page.evaluate(() => {
      const data = (window as Window & {
        __auditSnapshot?: {
          webdriverValue: string;
          canvasValue: string;
          webglVendor: string;
          webglRenderer: string;
        };
      }).__auditSnapshot;

      if (!data) {
        throw new Error("Audit snapshot was not populated");
      }

      return data;
    });

    console.log(JSON.stringify({ auditUrl, snapshot }));
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});