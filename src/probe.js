import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = path.resolve("debug");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});
const page = await context.newPage();

async function dump(name, p) {
  await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(OUT, `${name}.html`), await p.content());
  fs.writeFileSync(path.join(OUT, `${name}-url.txt`), p.url());
  const info = await p.evaluate(() => {
    const links = [...document.querySelectorAll("a")].map((a) => ({
      text: (a.innerText || "").trim().replace(/\s+/g, " ").slice(0, 100),
      href: a.href,
      visible: !!(a.offsetWidth || a.offsetHeight || a.getClientRects().length),
    }));
    const inputs = [...document.querySelectorAll("input, select, textarea, button")].map((el) => ({
      tag: el.tagName,
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      value: (el.value || "").slice(0, 40),
      placeholder: el.placeholder || "",
      text: (el.innerText || "").trim().slice(0, 60),
    }));
    return {
      title: document.title,
      body: document.body.innerText.slice(0, 4000),
      links: links.filter((l) => l.text || /event|order|reserve|guest|customer|calendar/i.test(l.href)),
      inputs,
    };
  });
  fs.writeFileSync(path.join(OUT, `${name}-info.json`), JSON.stringify(info, null, 2));
}

await page.goto("https://eipro.jp/takachiho1/terms/view/toppage", {
  waitUntil: "networkidle",
  timeout: 90000,
});
await page.waitForTimeout(1500);
await dump("01-top", page);

// Try force-click guest via evaluate
const guestHref = await page.evaluate(() => {
  const el = [...document.querySelectorAll("a, span, button")].find((e) =>
    (e.innerText || "").includes("会員登録せずに予約")
  );
  if (!el) return null;
  const a = el.closest("a") || el;
  return { href: a.href || a.getAttribute("href"), tag: a.tagName, html: a.outerHTML.slice(0, 500) };
});
fs.writeFileSync(path.join(OUT, "guest-href.json"), JSON.stringify(guestHref, null, 2));

if (guestHref?.href) {
  await page.goto(guestHref.href, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2000);
  await dump("02-guest", page);
}

// Calendar
await page.goto("https://eipro.jp/takachiho1/eventCalendars/index", {
  waitUntil: "networkidle",
  timeout: 90000,
});
await page.waitForTimeout(3000);
await dump("03-calendar", page);

// Try week / day views
for (const label of ["週", "日", "月"]) {
  const btn = page.locator(`text=${label}`).first();
  if (await btn.count()) {
    try {
      await btn.click({ timeout: 3000 });
      await page.waitForTimeout(2000);
      await dump(`04-view-${label}`, page);
    } catch {}
  }
}

await browser.close();
console.log("probe done");
