import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = path.resolve("debug");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, slowMo: 60 });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

async function dump(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(OUT, `${name}.html`), await page.content());
  fs.writeFileSync(path.join(OUT, `${name}-url.txt`), page.url());
}

await page.goto("https://eipro.jp/takachiho1/eventCalendars/index", {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForSelector("#service-full-calendar", { timeout: 60000 });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  const sel = document.querySelector("select.fullcalendar_control_date_list");
  sel.value = "2026/08/09";
  if (window.jQuery) window.jQuery(sel).val("2026/08/09").trigger("change");
  else sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(3500);

// Click 8/9 8:30 by hidden datetime value
const clicked = await page.evaluate(() => {
  const input = [...document.querySelectorAll(".service_unit_service_start_datetime")].find(
    (el) => el.value === "2026/08/09 08:30:00"
  );
  if (!input) return false;
  const event = input.closest("a.fc-time-grid-event, .fc-time-grid-event, .service_unit_calendar_view");
  (event || input).click();
  return true;
});
fs.writeFileSync(path.join(OUT, "clicked830.txt"), String(clicked));
await page.waitForTimeout(2000);
await dump("p4-dialog");

// Click 予約手続き in dialog
const reserveBtn = page.locator(".js_active_dialog, .js_dialog").getByText("予約手続き", { exact: false }).first();
if (await reserveBtn.count()) {
  await reserveBtn.click();
} else {
  await page.getByText("予約手続き", { exact: false }).first().click();
}
await page.waitForTimeout(3000);
await dump("p4-after-yoyaku");

// Dump visible buttons
const buttons = await page.evaluate(() =>
  [...document.querySelectorAll("button, a, input[type=button], input[type=submit]")]
    .filter((el) => el.offsetWidth || el.offsetHeight)
    .map((el) => ({
      text: (el.innerText || el.value || "").trim().slice(0, 80),
      className: el.className,
      id: el.id,
    }))
);
fs.writeFileSync(path.join(OUT, "p4-buttons.json"), JSON.stringify(buttons, null, 2));

// Click 会員登録せずに予約
const guest = page.locator("button.no_auth_order_btn_cls, .no_auth_order_btn_cls").first();
if (await guest.count()) {
  await guest.click({ force: true });
  await page.waitForTimeout(5000);
  await dump("p4-guest");
}

// Wait for possible navigation / form
await page.waitForTimeout(2000);
const fields = await page.evaluate(() =>
  [...document.querySelectorAll("input, select, textarea")].map((el) => ({
    tag: el.tagName,
    type: el.type || "",
    name: el.name || "",
    id: el.id || "",
    placeholder: el.placeholder || "",
    visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
  }))
);
fs.writeFileSync(path.join(OUT, "p4-fields.json"), JSON.stringify(fields, null, 2));
fs.writeFileSync(path.join(OUT, "p4-final-url.txt"), page.url());
fs.writeFileSync(path.join(OUT, "p4-final-body.txt"), await page.evaluate(() => document.body.innerText.slice(0, 5000)));

await page.waitForTimeout(1500);
await browser.close();
console.log("probe4 done");
