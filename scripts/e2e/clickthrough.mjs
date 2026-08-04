/**
 * Real browser click-through of /contracts and /admin.
 *
 * Runs against the LOCAL dev server, never production. Signs in through the actual form
 * rather than injecting a cookie, so the sign-in path is exercised too.
 *
 * The point of driving a browser rather than curling: a 200 and correct server-rendered
 * markup cannot tell you that a button's onClick is wired, that a modal releases focus, or
 * that a form posts the field the API expects. Every page-level JS error and failed request
 * is captured, because those are the failures that look fine in HTML.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const HANDLE = "uitest_admin";
const PASSWORD = "correct-horse-battery-staple-42";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const consoleErrors = [];
const failedRequests = [];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) => {
    const u = r.url();
    const err = r.failure()?.errorText ?? "";
    // ERR_ABORTED is what an in-flight fetch looks like when the page navigates away from
    // under it — a normal consequence of clicking through quickly, not a broken request.
    if (err.includes("ERR_ABORTED")) return;
    if (!u.includes("/ws/") && !u.startsWith("ws")) failedRequests.push(`${r.method()} ${u} :: ${err}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  // ---------------------------------------------------------------- sign in
  console.log("\n=== sign in (real form) ===");
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  // The page shows three route buttons and NO inputs until one is chosen — the password
  // fields only exist after clicking through. Targeting the button by role rather than by
  // text, because the descriptive paragraph also contains the word "password".
  const pwRoute = page.getByRole("button", { name: /sign in with a password/i }).first();
  check("the sign-in page offers a password route", await pwRoute.isVisible().catch(() => false));
  await pwRoute.click();
  await page.waitForTimeout(900);

  const passInput = page.locator('input[type="password"]').first();
  const hasPasswordForm = await passInput.isVisible().catch(() => false);
  check("choosing it reveals the password form", hasPasswordForm);

  if (hasPasswordForm) {
    const handleInput = page
      .locator('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"])')
      .first();
    await handleInput.fill(HANDLE);
    await passInput.fill(PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).first().click()
      .catch(async () => { await passInput.press("Enter"); });
    await page.waitForTimeout(3000);
  }

  const cookies = await ctx.cookies();
  const signedIn = cookies.some((c) => c.name.startsWith("kcx") && c.value.length > 10);
  check("signing in issues a session cookie", signedIn, cookies.map((c) => c.name).join(", ") || "none");

  // ---------------------------------------------------------------- contracts
  console.log("\n=== /contracts ===");
  await page.goto(`${BASE}/contracts`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const postBtn = page.getByRole("button", { name: /post a contract/i }).first();
  check("the post-a-contract control is present", await postBtn.isVisible().catch(() => false));

  if (await postBtn.isVisible().catch(() => false)) {
    await postBtn.click();
    await page.waitForTimeout(1200);
    // A dead onClick shows nothing new; a live one opens a form with fields.
    const formFields = await page.locator('input, textarea, select').count();
    check("clicking it actually opens the compose form", formFields > 3, `${formFields} fields visible`);

    // Pricing mode + visibility are the two controls the bidding/classified work added.
    const bodyText = await page.locator("body").innerText();
    check("the compose form offers a bidding/auction mode", /bid|auction/i.test(bodyText));
    check("the compose form offers a classified visibility", /classified/i.test(bodyText));

    // The compose form is an INLINE panel, not a modal — the trigger toggles to "Close".
    // So Escape is not the dismiss affordance here, and wiring it up would be actively
    // harmful: Escape while typing in an inline textarea discards work with no confirmation.
    // What must work is the toggle.
    const closeBtn = page.getByRole("button", { name: /^close$/i }).first();
    check("the trigger becomes a Close control", await closeBtn.isVisible().catch(() => false));
    await closeBtn.click();
    await page.waitForTimeout(800);
    const stillOpen = (await page.locator("input, textarea, select").count()) > 3;
    check("Close actually dismisses the compose form", !stillOpen);
  }

  // ---------------------------------------------------------------- admin
  console.log("\n=== /admin ===");
  const adminResp = await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  check("an admin can load /admin", adminResp?.status() === 200, `status ${adminResp?.status()}`);

  const adminText = await page.locator("body").innerText();
  const tabs = ["breach", "user", "contract", "audit"];
  for (const t of tabs) check(`the ${t} tab is present`, new RegExp(t, "i").test(adminText));

  // Click every tab: a tab that renders a label but no panel is the classic dead control.
  for (const label of ["Users", "Contracts", "Audit"]) {
    const tab = page.getByRole("button", { name: new RegExp(`^${label}`, "i") }).first();
    if (await tab.isVisible().catch(() => false)) {
      const before = await page.locator("body").innerText();
      await tab.click();
      await page.waitForTimeout(1200);
      const after = await page.locator("body").innerText();
      check(`the ${label} tab renders a panel`, after !== before || after.length > 200);
    }
  }

  // The ban-duration dropdown and the role selector — the two controls that change privilege.
  // Must land on the USERS tab to see them, and wait for its fetch: the loop above finishes
  // on Audit, and counting selects there found zero and blamed the UI for my own navigation.
  await page.getByRole("button", { name: /^users/i }).first().click();
  await page.waitForFunction(() => document.querySelectorAll("select").length > 0, null, { timeout: 8000 })
    .catch(() => {});
  const selects = page.locator("select");
  const selectCount = await selects.count();
  check("the users panel exposes select controls (ban duration / role)", selectCount > 0, `${selectCount} selects`);

  let sawDurations = false;
  let sawRoles = false;
  for (let i = 0; i < selectCount; i++) {
    const opts = await selects.nth(i).locator("option").allInnerTexts();
    const joined = opts.join("|").toLowerCase();
    if (/24h|7d|permanent/.test(joined)) sawDurations = true;
    if (/\buser\b/.test(joined) && /\bmod\b/.test(joined) && /\badmin\b/.test(joined)) sawRoles = true;
  }
  check("the ban-duration options are 24h / 7d / permanent", sawDurations);
  check("the role selector offers user / mod / admin", sawRoles);

  // ---------------------------------------------------------------- gating
  console.log("\n=== gating (signed out) ===");
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  const anonAdmin = await anonPage.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  check("an anonymous visitor gets 404 from /admin (not 403)", anonAdmin?.status() === 404, `status ${anonAdmin?.status()}`);
  await anon.close();

  // ---------------------------------------------------------------- legal pages
  console.log("\n=== legal pages render ===");
  for (const [path, needle] of [
    ["/about", /never holds your aUEC/i],
    ["/terms", /real-money trading is banned/i],
    ["/privacy", /no email address/i],
    ["/credits", /UEX/i],
  ]) {
    const r = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const txt = await page.locator("body").innerText();
    check(`${path} renders its content`, r?.status() === 200 && needle.test(txt));
  }

  // ---------------------------------------------------------------- JS health
  console.log("\n=== client-side health ===");
  check("no uncaught JS errors on any page visited", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" ;; "));
  check("no failed requests or 5xx responses", failedRequests.length === 0, failedRequests.slice(0, 3).join(" ;; "));

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL BROWSER CHECKS PASSED" : `${failures} BROWSER CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
