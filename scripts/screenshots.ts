import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const BASE = "http://localhost:3000";

  // --- Before: System of Records ---

  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/01-home.png" });
  console.log("✓ 01-home.png");

  await page.goto(`${BASE}/work-orders`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/02-work-orders.png", fullPage: true });
  console.log("✓ 02-work-orders.png");

  await page.goto(`${BASE}/technicians`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/03-technicians.png", fullPage: true });
  console.log("✓ 03-technicians.png");

  // --- After: Dispatch Dashboard ---

  await page.goto(`${BASE}/dispatch`);
  // Wait for the solve to complete and UI to update
  // The "Optimizing..." text disappears when solve finishes
  await page.waitForTimeout(12000); // solve + render + tile loading
  await page.screenshot({ path: "screenshots/04-dispatch-full.png" });
  console.log("✓ 04-dispatch-full.png");

  // --- Close-ups ---

  // Map close-up
  const mapEl = page.locator(".leaflet-container").first();
  if (await mapEl.isVisible()) {
    await mapEl.screenshot({ path: "screenshots/05-map-closeup.png" });
    console.log("✓ 05-map-closeup.png");
  }

  // Timeline close-up (the right panel area)
  const timelineArea = page.locator("[data-testid='timeline']").first();
  if (await timelineArea.isVisible().catch(() => false)) {
    await timelineArea.screenshot({ path: "screenshots/06-timeline-closeup.png" });
    console.log("✓ 06-timeline-closeup.png");
  } else {
    // Fallback: screenshot the right side of the page
    await page.screenshot({
      path: "screenshots/06-timeline-closeup.png",
      clip: { x: 580, y: 110, width: 860, height: 420 },
    });
    console.log("✓ 06-timeline-closeup.png (clip)");
  }

  // Unplanned queue / bottom right
  await page.screenshot({
    path: "screenshots/07-unplanned-queue.png",
    clip: { x: 580, y: 480, width: 860, height: 380 },
  });
  console.log("✓ 07-unplanned-queue.png");

  // KPI bar close-up
  await page.screenshot({
    path: "screenshots/08-kpi-bar.png",
    clip: { x: 0, y: 56, width: 1440, height: 56 },
  });
  console.log("✓ 08-kpi-bar.png");

  await browser.close();
  console.log("\nDone — screenshots saved to screenshots/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
