import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = path.resolve("debug");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, slowMo: 50 });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
});
const page = await context.newPage();

page.on("dialog", async (d) => {
  fs.appendFileSync(path.join(OUT, "dialogs.txt"), `${d.type()}: ${d.message()}\n`);
  await d.accept();
});

await page.goto("https://eipro.jp/takachiho1/eventCalendars/index", {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForSelector("#service-full-calendar", { timeout: 60000 });
await page.waitForTimeout(2500);

// Select week containing 8/9
await page.selectOption("select.fullcalendar_control_date_list", "2026/08/09");
await page.waitForTimeout(3000);

// Force change event if select2
await page.evaluate(() => {
  const sel = document.querySelector("select.fullcalendar_control_date_list");
  if (!sel) return;
  sel.value = "2026/08/09";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  if (window.jQuery) window.jQuery(sel).val("2026/08/09").trigger("change");
});
await page.waitForTimeout(4000);

await page.screenshot({ path: path.join(OUT, "aug9-week.png"), fullPage: true });

const events = await page.evaluate(() => {
  const items = [...document.querySelectorAll(".fc-event, .fc-bgevent, a.fc-time-grid-event")];
  return items.map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      text: (el.innerText || "").trim().slice(0, 80),
      title: el.getAttribute("title") || "",
      className: el.className,
      start: el.getAttribute("data-start") || "",
      href: el.getAttribute("href") || "",
      html: el.outerHTML.slice(0, 400),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
  });
});
fs.writeFileSync(path.join(OUT, "aug9-events.json"), JSON.stringify(events, null, 2));

// Also collect all slot forms / hidden datetime values for 8/9
const slots = await page.evaluate(() => {
  const starts = [...document.querySelectorAll(".service_unit_service_start_datetime")].map(
    (el) => el.value
  );
  const forms = [...document.querySelectorAll("form")].map((f) => ({
    action: f.action,
    id: f.id,
    className: f.className,
    html: f.outerHTML.slice(0, 500),
  }));
  const bg = [...document.querySelectorAll(".fc-bgevent, .fc-event")].slice(0, 100).map((el) => ({
    className: el.className,
    style: el.getAttribute("style") || "",
    text: (el.innerText || "").trim(),
    title: el.title || "",
  }));
  return { starts: starts.filter((v) => v.includes("2026/08/09")), forms, bg };
});
fs.writeFileSync(path.join(OUT, "aug9-slots.json"), JSON.stringify(slots, null, 2));

// Click guest button if visible; otherwise force show + click
await page.evaluate(() => {
  const btn = document.querySelector(".no_auth_order_btn_cls");
  if (btn) {
    btn.style.display = "block";
    btn.style.visibility = "visible";
    btn.style.opacity = "1";
    btn.click();
  }
});
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, "after-guest-click.png"), fullPage: true });
fs.writeFileSync(path.join(OUT, "after-guest-url.txt"), page.url());

// Try click an available-looking event on 8/9 8:30
const clicked = await page.evaluate(() => {
  const candidates = [...document.querySelectorAll(".fc-time-grid-event, .fc-event")];
  const hit = candidates.find((el) => {
    const t = (el.innerText || "") + " " + (el.title || "") + " " + el.outerHTML;
    return /08\/09|8\/9|08:30|8:30/.test(t) && !/×|完売|sold/i.test(t);
  });
  if (hit) {
    hit.click();
    return hit.outerHTML.slice(0, 500);
  }
  // fallback: click cell by time axis
  const timeRows = [...document.querySelectorAll(".fc-slats tr")];
  return { count: candidates.length, sample: candidates.slice(0, 5).map((c) => c.outerHTML.slice(0, 200)), timeRows: timeRows.length };
});
fs.writeFileSync(path.join(OUT, "click-result.json"), JSON.stringify(clicked, null, 2));
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(OUT, "after-slot-click.png"), fullPage: true });
fs.writeFileSync(path.join(OUT, "after-slot.html"), await page.content());
fs.writeFileSync(path.join(OUT, "after-slot-url.txt"), page.url());

await page.waitForTimeout(2000);
await browser.close();
console.log("probe2 done");
