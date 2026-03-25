import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({
    args: ["--enable-webgl", "--use-gl=swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const BASE = "http://localhost:3000";

  // --- Before: System of Records ---

  // Home page with new Dispatch button in nav
  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/01-home.png" });
  console.log("✓ 01-home.png");

  // Work Orders table
  await page.goto(`${BASE}/work-orders`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/02-work-orders.png", fullPage: true });
  console.log("✓ 02-work-orders.png");

  // Technicians table
  await page.goto(`${BASE}/technicians`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/03-technicians.png", fullPage: true });
  console.log("✓ 03-technicians.png");

  // --- After: Dispatch Dashboard ---

  // Dispatch page
  await page.goto(`${BASE}/dispatch`);
  // Wait for components to render (map tiles + timeline)
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "screenshots/04-dispatch-full.png" });
  console.log("✓ 04-dispatch-full.png");

  await browser.close();
  console.log("\nDone — screenshots saved to screenshots/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
