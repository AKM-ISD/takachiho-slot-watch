import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = path.resolve("debug");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, slowMo: 80 });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

page.on("dialog", async (d) => {
  fs.appendFileSync(path.join(OUT, "dialogs3.txt"), `${d.type()}: ${d.message()}\n`);
  await d.dismiss().catch(() => {});
});

await page.goto("https://eipro.jp/takachiho1/eventCalendars/index", {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForSelector("#service-full-calendar", { timeout: 60000 });
await page.waitForTimeout(2000);

await page.evaluate(() => {
  const sel = document.querySelector("select.fullcalendar_control_date_list");
  if (!sel) return;
  sel.value = "2026/08/09";
  if (window.jQuery) window.jQuery(sel).val("2026/08/09").trigger("change");
  else sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(4000);

// Find 8/9 8:30 event precisely via data-start + date column
const target = page.locator(".fc-time-grid-event").filter({
  has: page.locator('.fc-time[data-start="8:30"]'),
}).first();

const count = await page.locator(".fc-time-grid-event").count();
fs.writeFileSync(path.join(OUT, "event-count.txt"), String(count));

// Dump full HTML of matching events
const detail = await page.evaluate(() => {
  return [...document.querySelectorAll(".fc-time-grid-event")].filter((el) => {
    const t = el.querySelector(".fc-time");
    return t && ["8:30", "9:00", "9:30"].includes(t.getAttribute("data-start"));
  }).map((el) => {
    const col = el.closest(".fc-content-col, .fc-event-container")?.parentElement;
    const day = el.closest("[data-date]")?.getAttribute("data-date")
      || el.closest(".fc-day")?.getAttribute("data-date")
      || "";
    return {
      dataStart: el.querySelector(".fc-time")?.getAttribute("data-start"),
      dataFull: el.querySelector(".fc-time")?.getAttribute("data-full"),
      text: el.innerText.trim(),
      day,
      parentClass: el.parentElement?.className,
      html: el.outerHTML.slice(0, 1500),
      // look for associated form nearby
      nextForm: el.querySelector("form")?.outerHTML?.slice(0, 800) || null,
    };
  });
});
fs.writeFileSync(path.join(OUT, "target-events.json"), JSON.stringify(detail, null, 2));

// Also map columns to dates
const cols = await page.evaluate(() => {
  return [...document.querySelectorAll(".fc-day-header, th.fc-day-header, .fc-axis + th, [data-date]")].map((el) => ({
    text: (el.innerText || "").trim(),
    date: el.getAttribute("data-date") || "",
    className: el.className,
  }));
});
fs.writeFileSync(path.join(OUT, "day-headers.json"), JSON.stringify(cols, null, 2));

// Click first 8:30 event in first column (should be 8/9)
await target.scrollIntoViewIfNeeded();
await target.click({ timeout: 10000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, "after-830-click.png"), fullPage: true });
fs.writeFileSync(path.join(OUT, "after-830-url.txt"), page.url());

const modal = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll(".ui-dialog, .modal, [role=dialog], .dialog, .popup, .fancybox-wrap, #loginDialog, .login_dialog, .order_dialog")]
    .map((el) => ({
      className: el.className,
      id: el.id,
      visible: !!(el.offsetWidth || el.offsetHeight),
      text: (el.innerText || "").trim().slice(0, 500),
      html: el.outerHTML.slice(0, 1000),
    }));
  const guestBtn = document.querySelector(".no_auth_order_btn_cls");
  return {
    dialogs,
    guestVisible: guestBtn ? getComputedStyle(guestBtn).display : null,
    bodyText: document.body.innerText.slice(0, 2000),
    overlays: [...document.querySelectorAll("div")].filter((d) => /会員登録せず|ログイン|予約/.test(d.innerText || "") && d.offsetWidth > 100 && d.offsetHeight > 50).slice(0, 10).map((d) => ({
      id: d.id,
      className: d.className,
      text: d.innerText.trim().slice(0, 200),
    })),
  };
});
fs.writeFileSync(path.join(OUT, "modal-info.json"), JSON.stringify(modal, null, 2));

// If guest button now usable, click it
const guest = page.locator(".no_auth_order_btn_cls").first();
if (await guest.isVisible().catch(() => false)) {
  await guest.click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUT, "order-form.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "order-form-url.txt"), page.url());
  fs.writeFileSync(path.join(OUT, "order-form.html"), await page.content());
  const fields = await page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")].map((el) => ({
      tag: el.tagName,
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      placeholder: el.placeholder || "",
      label: el.closest("tr, .line, .form-group, article")?.innerText?.trim()?.slice(0, 80) || "",
    }))
  );
  fs.writeFileSync(path.join(OUT, "order-fields.json"), JSON.stringify(fields, null, 2));
} else {
  // Try click text button
  const byText = page.getByRole("button", { name: /会員登録せずに予約/ });
  if (await byText.count()) {
    await byText.first().click({ force: true });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(OUT, "order-form.png"), fullPage: true });
    fs.writeFileSync(path.join(OUT, "order-form-url.txt"), page.url());
    fs.writeFileSync(path.join(OUT, "order-form.html"), await page.content());
    const fields = await page.evaluate(() =>
      [...document.querySelectorAll("input, select, textarea")].map((el) => ({
        tag: el.tagName,
        type: el.type || "",
        name: el.name || "",
        id: el.id || "",
        placeholder: el.placeholder || "",
      }))
    );
    fs.writeFileSync(path.join(OUT, "order-fields.json"), JSON.stringify(fields, null, 2));
  }
}

await page.waitForTimeout(2000);
await browser.close();
console.log("probe3 done");
