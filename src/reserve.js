import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.local.json");
const CALENDAR_URL = "https://eipro.jp/takachiho1/eventCalendars/index";

if (!fs.existsSync(CONFIG_PATH)) {
  console.error("config.local.json がありません。");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const log = (...args) => console.log(`[${new Date().toLocaleTimeString("ja-JP")}]`, ...args);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function endTimeOf(startHHMM) {
  const [h, m] = startHHMM.split(":").map(Number);
  const total = h * 60 + m + 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function slotStart(date, time) {
  return `${date} ${time}:00`;
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

async function safeText(page) {
  return page.evaluate(() => document.body?.innerText || "").catch(() => "");
}

async function gotoCalendarWeek(page, date) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(CALENDAR_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForSelector("#service-full-calendar", { timeout: 60000 });
      await waitLoadingGone(page);
      await page.waitForTimeout(600);
      await page.evaluate((d) => {
        const sel = document.querySelector("select.fullcalendar_control_date_list");
        if (!sel) return;
        sel.value = d;
        if (window.jQuery) window.jQuery(sel).val(d).trigger("change");
        else sel.dispatchEvent(new Event("change", { bubbles: true }));
      }, date);
      await page.waitForTimeout(2200);
      await waitLoadingGone(page);
      return;
    } catch (e) {
      log("カレンダー再読込:", e.message);
      await sleep(1000);
    }
  }
  throw new Error("カレンダー表示失敗");
}

async function findAvailableSlot(page, date, time) {
  const start = slotStart(date, time);
  return page.evaluate((startVal) => {
    const input = [...document.querySelectorAll(".service_unit_service_start_datetime")].find(
      (el) => el.value === startVal
    );
    if (!input) return { ok: false, reason: "not-found" };
    const root =
      input.closest("a.fc-time-grid-event") ||
      input.closest(".fc-time-grid-event") ||
      input.closest(".service_unit_calendar_view");
    if (!root) return { ok: false, reason: "no-root" };
    const html = root.innerHTML + (root.innerText || "");
    if (/残\d+艇/.test(html) || /fa-circle/.test(html)) {
      const remain = (html.match(/残(\d+)艇/) || [])[1];
      return { ok: true, remain: remain ? Number(remain) : null };
    }
    if (/fa-hourglass/.test(html)) return { ok: false, reason: "not-open" };
    if (/fa-xmark|fa-times|×/.test(html)) return { ok: false, reason: "soldout" };
    return { ok: false, reason: "unavailable" };
  }, start);
}

async function clickSlot(page, date, time) {
  const start = slotStart(date, time);
  return page.evaluate((startVal) => {
    const input = [...document.querySelectorAll(".service_unit_service_start_datetime")].find(
      (el) => el.value === startVal
    );
    if (!input) return false;
    const clickable =
      input.closest("a.fc-time-grid-event") ||
      input.closest(".fc-time-grid-event") ||
      input.closest(".service_unit_calendar_view");
    if (!clickable) return false;
    clickable.scrollIntoView({ block: "center" });
    clickable.click();
    return true;
  }, start);
}

async function clickYoyakuTetsuzuki(page) {
  await page.waitForTimeout(800);
  const inDialog = page.locator(".js_active_dialog, .js_dialog").getByText("予約手続き", { exact: false }).first();
  if (await inDialog.count()) {
    await Promise.all([
      page.waitForURL(/orders\/add/, { timeout: 90000 }).catch(() => {}),
      inDialog.click(),
    ]);
    return true;
  }
  const btn = page.getByText("予約手続き", { exact: false }).first();
  if (await btn.count()) {
    await Promise.all([
      page.waitForURL(/orders\/add/, { timeout: 90000 }).catch(() => {}),
      btn.click(),
    ]);
    return true;
  }
  return /orders\/add/.test(page.url());
}

async function fillPayjp(page, card) {
  await page.locator("#front_element_payment_type_credit_card_number_id iframe").waitFor({ timeout: 45000 });
  await page.waitForTimeout(700);

  const fillFrame = async (namePart, value) => {
    const frame = page.frameLocator(`iframe[name*="${namePart}"]`).first();
    const input = frame.locator("input").first();
    await input.waitFor({ state: "visible", timeout: 25000 });
    await input.click({ timeout: 5000 }).catch(() => {});
    await input.fill("");
    await input.pressSequentially(value, { delay: 25 });
  };

  await fillFrame("cardNumber", card.number.replace(/\s/g, ""));
  // Pay.jp expiry は MMYY 連続入力が安定
  await fillFrame("cardExpiry", `${card.expMonth}${card.expYear}`);
  await fillFrame("cardCvc", card.cvc);
  await page.fill("#front_element_payment_type_credit_card_holdername_id", card.holder);
  await page.waitForTimeout(600);
}

async function fillOrderForm(page, cfg) {
  await page.waitForSelector('input[name="data[Customer][l_name]"]', { timeout: 90000 });
  await waitLoadingGone(page);
  const c = cfg.customer;

  await page.fill('input[name="data[Customer][l_name]"]', c.lName);
  await page.fill('input[name="data[Customer][f_name]"]', c.fName);
  await page.fill('input[name="data[Customer][l_name_kana]"]', c.lNameKana);
  await page.fill('input[name="data[Customer][f_name_kana]"]', c.fNameKana);
  await page.fill('input[name="data[Customer][mail]"]', c.mail);
  await page.fill('input[name="data[Customer][mobile_tel]"]', c.mobileTel);
  await page.fill('input[name="data[CustomerQuestionAnswer][4][answer]"]', c.address);
  await page.fill('input[name="data[Customer][birth_date]"]', c.birthDate);
  await page.selectOption('select[name="data[CustomerQuestionAnswer][6][answer]"]', cfg.party);

  const labels = [
    "「予約に関する確認事項」に同意します。",
    "「予約受付期間とキャンセル料について」に同意します。",
    "「ボート利用に関する禁止事項・注意事項について」を確認しました。",
  ];
  for (const text of labels) {
    const label = page.locator("label.check_label", { hasText: text }).first();
    if (await label.count()) await label.click({ force: true });
  }
  await page.evaluate(() => {
    for (const cb of document.querySelectorAll('input.multiple-input[type="checkbox"]')) {
      if (!cb.checked) cb.click();
    }
  });

  await fillPayjp(page, cfg.card);
}

async function visibleErrors(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".error-message, .input_error_message, .error-exist")]
      .filter((el) => {
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && (el.innerText || "").trim();
      })
      .map((el) => el.innerText.trim().slice(0, 100))
  );
}

async function isComplete(page) {
  const text = await safeText(page);
  return /予約番号|整理番号|予約が完了|ご予約ありがとうございます/.test(text);
}

async function isFatalError(page) {
  const url = page.url();
  if (/error\/index|MSG_/.test(url)) return true;
  const text = await safeText(page);
  return [
    /既に完売/,
    /満席となりました/,
    /空きがありません/,
    /残席がありません/,
    /この日時は予約できません/,
    /予約枠がありません/,
    /同一.*代表者/,
    /既に予約/,
  ].some((re) => re.test(text));
}

async function is3ds(page) {
  const url = page.url();
  if (/pay\.jp\/v1\/tds|tds2|3dsecure|cardinalcommerce|\.acs\./i.test(url)) return true;
  if (/orders\/(add|confirm)/.test(url)) return false;
  const text = (await safeText(page)).slice(0, 1000);
  return /ワンタイムパスワード|認証コードを入力|本人認証/.test(text) && !/予約入力/.test(text);
}

async function clickAndWaitNav(page, locator) {
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 120000 }).catch(() => {}),
    locator.click(),
  ]);
  await waitLoadingGone(page, 180000);
  await page.waitForTimeout(800);
}

async function submitOrder(page) {
  const inputConfirm = page.locator("button.submit").filter({ hasText: "入力確認" }).first();
  if (await inputConfirm.isVisible().catch(() => false)) {
    log("入力確認クリック");
    await clickAndWaitNav(page, inputConfirm);
    const errs = await visibleErrors(page);
    if (errs.length) {
      log("入力エラー:", errs.join(" / "));
      return "validation";
    }
  }

  if (await isComplete(page)) return "complete";
  if (await isFatalError(page)) return "fatal";

  const candidates = page.locator("button.submit.front_btn");
  const count = await candidates.count();
  for (let i = 0; i < count; i++) {
    const btn = candidates.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const t = ((await btn.innerText()) || "").trim();
    if (/入力確認|戻る|キャンセル|閉じる/.test(t)) continue;
    if (/予約|確定|申込|申し込み|送信/.test(t) || t.length > 0) {
      log(`確定クリック: ${t}`);
      await clickAndWaitNav(page, btn);
      break;
    }
  }

  if (await isComplete(page)) return "complete";
  if (await isFatalError(page)) return "fatal";
  if (await is3ds(page)) return "3ds";
  return "pending";
}

async function waitUntilDone(page, time) {
  log(`[${time}] 3Dセキュア/完了待ち。認証画面が出たら手動で操作してください`);
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    if (await isComplete(page)) {
      log(`[${time}] ★ 予約完了`);
      return "complete";
    }
    if (await isFatalError(page)) {
      log(`[${time}] エラー/完売: ${page.url()}`);
      return "fatal";
    }
    // 確認画面にボタンが残っていれば押す
    const btn = page.locator("button.submit.front_btn").filter({ hasNotText: "入力確認" }).first();
    if (await btn.isVisible().catch(() => false)) {
      const t = ((await btn.innerText()) || "").trim();
      if (t && !/戻る|キャンセル/.test(t)) {
        log(`[${time}] 再クリック: ${t}`);
        await clickAndWaitNav(page, btn).catch(() => {});
      }
    }
    await sleep(1000);
  }
  return (await isComplete(page)) ? "complete" : "timeout";
}

async function attempt(page, cfg, time) {
  log(`--- ${time} を試行 ---`);
  await gotoCalendarWeek(page, cfg.targetDate);
  const avail = await findAvailableSlot(page, cfg.targetDate, time);
  log(`[${time}] 空き:`, avail);
  if (!avail.ok) return "retry";

  if (!(await clickSlot(page, cfg.targetDate, time))) {
    log(`[${time}] スロットクリック失敗`);
    return "retry";
  }
  await page.waitForTimeout(1000);
  await waitLoadingGone(page);

  if (!(await clickYoyakuTetsuzuki(page))) {
    log(`[${time}] 予約手続きへ進めず`);
    return "retry";
  }
  await waitLoadingGone(page, 180000);

  if (await isFatalError(page)) {
    log(`[${time}] 遷移後エラー: ${page.url()}`);
    return "retry";
  }
  if (!/orders\/add/.test(page.url())) {
    log(`[${time}] 注文画面でない: ${page.url()}`);
    return "retry";
  }

  log(`[${time}] フォーム入力`);
  await fillOrderForm(page, cfg);

  const result = await submitOrder(page);
  log(`[${time}] submit=${result} url=${page.url()}`);
  if (result === "complete") return "complete";
  if (result === "validation" || result === "fatal") return "retry";
  return waitUntilDone(page, time);
}

async function main() {
  log("高千穂峡ボート自動予約 開始（1枠ずつ順番に試行・完了まで反復）");
  log(`対象: ${config.targetDate} / ${config.preferredTimes.join(", ")}`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 40,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "ja-JP",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("dialog", async (d) => {
    log("dialog:", d.message());
    await d.accept().catch(() => {});
  });

  // 3タブ相当: 各時間をラウンドロビンで回す（同一名義の同時送信衝突を回避）
  let round = 0;
  let done = false;
  while (!done) {
    round += 1;
    if (config.maxRound > 0 && round > config.maxRound) break;
    log(`===== round ${round} =====`);
    for (const time of config.preferredTimes) {
      try {
        const r = await attempt(page, config, time);
        if (r === "complete") {
          done = true;
          break;
        }
      } catch (e) {
        log(`[${time}] 例外:`, e.message || e);
      }
      await sleep(config.retryDelayMs || 800);
    }
  }

  if (done) {
    log("成功。ブラウザを60秒残します");
    await sleep(60000);
  } else {
    log("未完了。ブラウザを確認してください");
    await sleep(30000);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
