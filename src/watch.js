import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.local.json");
const STATE_PATH = path.join(ROOT, ".watch-state.json");
const TOP_URL = "https://eipro.jp/takachiho1/terms/view/toppage";
const CALENDAR_URL = "https://eipro.jp/takachiho1/eventCalendars/index";
const IS_CI = process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true";
const SLACK_MENTION = "<@U05QLS5V34N>";

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  }
  return {};
}

const config = loadConfig();
const INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS) || config.checkIntervalMs || 15 * 60 * 1000;
const TARGET_DATE = process.env.TARGET_DATE || config.targetDate || "2026/08/09";
const WEBHOOK = process.env.SLACK_WEBHOOK_URL || config.slackWebhookUrl;

if (!WEBHOOK) {
  console.error("SLACK_WEBHOOK_URL（環境変数）または config.local.json の slackWebhookUrl を設定してください。");
  process.exit(1);
}

const log = (...args) => console.log(`[${new Date().toLocaleTimeString("ja-JP")}]`, ...args);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { lastFingerprint: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function notifySlack(text) {
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack通知失敗: ${res.status} ${body}`);
  }
}

async function waitLoadingGone(page, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const busy = await page
      .evaluate(() => {
        const spinners = [...document.querySelectorAll(".loading, .loader, .spinner, #loading, .blockUI")];
        return spinners.some((el) => {
          const s = getComputedStyle(el);
          return s.display !== "none" && s.visibility !== "hidden" && el.offsetWidth + el.offsetHeight > 0;
        });
      })
      .catch(() => false);
    if (!busy) return;
    await sleep(250);
  }
}

async function openCalendar(page) {
  // トップ到達確認 → カレンダーへ（ゲストボタンはモーダル内で非表示のことがあるため直URLも可）
  await page.goto(TOP_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitLoadingGone(page);

  const clicked = await page.evaluate(() => {
    const btn = document.querySelector("button.no_auth_order_btn_cls, .no_auth_order_btn_cls");
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (clicked) {
    await page.waitForURL(/eventCalendars/, { timeout: 15000 }).catch(() => {});
    await waitLoadingGone(page);
  }

  if (!/eventCalendars/.test(page.url())) {
    await page.goto(CALENDAR_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitLoadingGone(page);
  }

  await page.waitForSelector("#service-full-calendar", { timeout: 60000 });
  await page.evaluate((d) => {
    const sel = document.querySelector("select.fullcalendar_control_date_list");
    if (!sel) return;
    sel.value = d;
    if (window.jQuery) window.jQuery(sel).val(d).trigger("change");
    else sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, TARGET_DATE);
  await page.waitForTimeout(2200);
  await waitLoadingGone(page);
}

/** @returns {Promise<{ time: string, remain: number|null, status: string }[]>} */
async function scanSlots(page) {
  return page.evaluate((datePrefix) => {
    const results = [];
    for (const input of document.querySelectorAll(".service_unit_service_start_datetime")) {
      const val = input.value || "";
      if (!val.startsWith(datePrefix)) continue;
      const time = val.slice(11, 16);
      const root =
        input.closest("a.fc-time-grid-event") ||
        input.closest(".fc-time-grid-event") ||
        input.closest(".service_unit_calendar_view");
      if (!root) {
        results.push({ time, remain: null, status: "unknown" });
        continue;
      }
      const html = root.innerHTML + (root.innerText || "");
      if (/残\d+艇/.test(html) || /fa-circle/.test(html)) {
        const remain = (html.match(/残(\d+)艇/) || [])[1];
        results.push({ time, remain: remain ? Number(remain) : null, status: "available" });
      } else if (/fa-hourglass/.test(html)) {
        results.push({ time, remain: null, status: "not-open" });
      } else if (/fa-xmark|fa-times|×/.test(html)) {
        results.push({ time, remain: null, status: "soldout" });
      } else {
        results.push({ time, remain: null, status: "unavailable" });
      }
    }
    results.sort((a, b) => a.time.localeCompare(b.time));
    return results;
  }, TARGET_DATE);
}

function fingerprint(available) {
  return available.map((s) => `${s.time}:${s.remain ?? "?"}`).join("|");
}

function formatAvailable(available) {
  return available
    .map((s) => (s.remain != null ? `${s.time}（残${s.remain}艇）` : s.time))
    .join("\n");
}

async function checkOnce(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "ja-JP",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("dialog", async (d) => {
    await d.accept().catch(() => {});
  });

  try {
    await openCalendar(page);
    const slots = await scanSlots(page);
    const available = slots.filter((s) => s.status === "available");
    const summary = {
      total: slots.length,
      available: available.length,
      soldout: slots.filter((s) => s.status === "soldout").length,
      notOpen: slots.filter((s) => s.status === "not-open").length,
    };
    log(
      `${TARGET_DATE} 枠=${summary.total} 空き=${summary.available} 完売=${summary.soldout} 未開放=${summary.notOpen}`
    );
    if (available.length) {
      log("空き:", available.map((s) => `${s.time}${s.remain != null ? `(残${s.remain})` : ""}`).join(", "));
    }
    return { slots, available };
  } finally {
    await context.close();
  }
}

const ONCE = process.argv.includes("--once");

async function main() {
  log(`空き枠監視開始: ${TARGET_DATE} / ${ONCE ? "1回のみ" : `間隔 ${INTERVAL_MS / 60000} 分`}`);
  log(`入口: ${TOP_URL}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  if (!ONCE) {
    await notifySlack(
      `高千穂峡ボート空き監視を開始しました\n対象日: ${TARGET_DATE}\n間隔: ${INTERVAL_MS / 60000}分\n予約サイト: ${TOP_URL}`
    ).catch((e) => log("開始通知失敗:", e.message));
  }

  const state = loadState();

  const run = async () => {
    try {
      const { available } = await checkOnce(browser);
      if (!available.length) {
        log("空きなし");
        return;
      }
      const fp = fingerprint(available);
      if (fp === state.lastFingerprint) {
        log("空きあり（前回と同じ内容のため通知スキップ）");
        return;
      }
      const msg = [
        `${SLACK_MENTION}`,
        `【空き枠あり】高千穂峡貸しボート ${TARGET_DATE}`,
        "",
        formatAvailable(available),
        "",
        `<${TOP_URL}|予約サイト>`,
      ].join("\n");
      await notifySlack(msg);
      state.lastFingerprint = fp;
      state.lastNotifiedAt = new Date().toISOString();
      saveState(state);
      log("Slack通知済み");
    } catch (e) {
      log("チェック失敗:", e.message || e);
      // ローカル常駐時はここで通知。CI は workflow の failure ステップで通知
      if (!IS_CI) {
        await notifySlack(
          `${SLACK_MENTION}\n空き枠監視エラー: ${e.message || e}\n<${TOP_URL}|予約サイト>`
        ).catch(() => {});
      }
      if (ONCE) throw e;
    }
  };

  await run();

  if (ONCE) {
    await browser.close();
    return;
  }

  setInterval(run, INTERVAL_MS);

  process.on("SIGINT", async () => {
    log("停止します");
    await browser.close().catch(() => {});
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
