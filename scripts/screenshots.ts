import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const BASE = "http://localhost:3000";

  // Home page
  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/home.png" });
  console.log("✓ home.png");

  // Work Orders page
  await page.goto(`${BASE}/work-orders`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/work-orders.png", fullPage: true });
  console.log("✓ work-orders.png");

  // Technicians page
  await page.goto(`${BASE}/technicians`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/technicians.png", fullPage: true });
  console.log("✓ technicians.png");

  await browser.close();
  console.log("\nDone — screenshots saved to screenshots/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
