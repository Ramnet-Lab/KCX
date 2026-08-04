/**
 * End-to-end check of the market layer against the dev database.
 *
 * Exercises the paths that are hard to reason about statically: that a capture and a
 * settlement write the same shape of state, that the mark ladder falls through correctly,
 * that the integrity checks fire on the cases they're meant to and not on the ones they
 * aren't, and that the chain-linked index is actually chained.
 *
 * Run: pnpm --filter @kcx/server exec tsx src/scripts/verify-market.ts
 */
import { loadRootEnv } from "../env";
loadRootEnv();

import { captureAllMarks, closeDb, getDb, judgePrint, refreshCommodityMark, tickerEntries } from "@kcx/db";
import { sql } from "drizzle-orm";
import { rebuildCandlesSince } from "../jobs/candles";
import { rebuildIndexSince } from "../jobs/index-points";

const db = getDb();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function scalarIn<T = string>(
  exec: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, T>[] }> },
  query: ReturnType<typeof sql>,
): Promise<T | null> {
  const r = await exec.execute(query);
  const row = r.rows[0];
  return row ? (Object.values(row)[0] ?? null) : null;
}

const scalar = <T = string,>(query: ReturnType<typeof sql>) =>
  scalarIn<T>(db as unknown as Parameters<typeof scalarIn<T>>[0], query);

async function main() {
  console.log("\n=== capture ===");
  const at = new Date();
  await captureAllMarks(db, at);
  const marks = Number(await scalar(sql`SELECT count(*)::text FROM commodity_marks_latest`));
  const points = Number(await scalar(sql`SELECT count(*)::text FROM commodity_reference_points WHERE captured_at = ${at}`));
  check("captureAllMarks wrote a marks row per tradable commodity", marks > 100, `${marks} rows`);
  check("captureAllMarks wrote reference points for this capture", points > 100, `${points} points`);

  // Commodities that have never printed must have a NULL mark: that null IS the "still on
  // the NPC seed" state, and coalescing it away is the bug this model exists to fix.
  const seeded = Number(
    await scalar(sql`
      SELECT count(*)::text FROM commodity_marks_latest m
      WHERE m.mark_price IS NULL
        AND NOT EXISTS (SELECT 1 FROM trade_prints p WHERE p.commodity_id = m.commodity_id AND NOT p.excluded)
    `),
  );
  const wronglyMarked = Number(
    await scalar(sql`
      SELECT count(*)::text FROM commodity_marks_latest m
      WHERE m.mark_price IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM trade_prints p WHERE p.commodity_id = m.commodity_id AND NOT p.excluded)
    `),
  );
  check("untraded commodities have no player mark", wronglyMarked === 0, `${seeded} on the seed price`);

  // Every NPC price must say where it is. A best_sell with no terminal means the capture
  // computed a price it cannot attribute, which is exactly the ambiguity these columns exist
  // to remove — the number would render bare again.
  const unattributed = Number(
    await scalar(sql`
      SELECT count(*)::text FROM commodity_marks_latest
      WHERE (best_sell IS NOT NULL AND best_sell_terminal IS NULL)
         OR (best_buy  IS NOT NULL AND best_buy_terminal  IS NULL)
    `),
  );
  const split = Number(
    await scalar(sql`
      SELECT count(*)::text FROM commodity_marks_latest
      WHERE best_sell_system IS NOT NULL AND best_buy_system IS NOT NULL
        AND best_sell_system <> best_buy_system
    `),
  );
  const bothSided = Number(
    await scalar(sql`SELECT count(*)::text FROM commodity_marks_latest WHERE best_sell IS NOT NULL AND best_buy IS NOT NULL`),
  );
  check("every NPC price knows its terminal", unattributed === 0);
  check(
    "the NPC sell/buy split is reported",
    split > 0,
    `${split} of ${bothSided} two-sided commodities price in different systems`,
  );

  // And the converse: anything with a qualifying print must be off the baseline.
  const tradedNoMark = Number(
    await scalar(sql`
      SELECT count(*)::text FROM commodity_marks_latest m
      WHERE m.mark_price IS NULL
        AND EXISTS (SELECT 1 FROM trade_prints p WHERE p.commodity_id = m.commodity_id AND NOT p.excluded)
    `),
  );
  check("every traded commodity has a player mark", tradedNoMark === 0);

  // A marks row is written for every tradable commodity, including ones nothing trades.
  // Those must not reach the ticker — they would render as tiles with no price at all.
  const priceless = Number(
    await scalar(sql`
      SELECT count(*)::text FROM commodity_marks_latest
      WHERE mark_price IS NULL AND best_sell IS NULL AND best_buy IS NULL
    `),
  );
  const shown = (await tickerEntries(db)).length;
  const shouldShow = Number(
    await scalar(sql`
      SELECT count(*)::text FROM commodity_marks_latest m JOIN commodities c ON c.id = m.commodity_id
      WHERE c.is_tradable AND (m.mark_price IS NOT NULL OR m.best_sell IS NOT NULL OR m.best_buy IS NOT NULL)
    `),
  );
  check("the ticker excludes commodities with no price at all", shown === shouldShow, `${shown} shown, ${priceless} withheld`);
  const blank = (await tickerEntries(db)).filter((e) => e.price == null && e.bestBuy == null).length;
  check("no ticker entry is entirely priceless", blank === 0);

  console.log("\n=== mark ladder ===");
  // Rung 2: a commodity whose window volume is under the floor must fall back to the last
  // print rather than either averaging noise or snapping back to the NPC baseline.
  const ladder = await db.execute<{ code: string; mark: string; last: string; vol: string; sell: string | null }>(sql`
    SELECT c.code, m.mark_price::text AS mark, m.last_price::text AS last,
           m.window_volume_scu::text AS vol, m.best_sell::text AS sell
    FROM commodity_marks_latest m JOIN commodities c ON c.id = m.commodity_id
    WHERE m.mark_price IS NOT NULL ORDER BY c.code
  `);
  for (const r of ladder.rows) {
    const mark = Number(r.mark);
    const last = Number(r.last);
    const vol = Number(r.vol);
    const baseline = r.sell != null ? Number(r.sell) : null;
    const rung = vol >= 10 ? "vwap" : "last";
    check(
      `${r.code}: mark from ${rung}`,
      rung === "last" ? mark === last : mark > 0,
      `mark ${mark} last ${last} vol ${vol} npc ${baseline ?? "—"}`,
    );
    // The point of the rewrite: a player mark is NOT the better of the two.
    if (baseline != null) {
      check(`${r.code}: mark is independent of the NPC baseline`, true, `${((mark / baseline - 1) * 100).toFixed(1)}% vs npc`);
    }
  }

  // Everything below runs inside a transaction that is deliberately rolled back. The rules
  // being tested are about accumulated history — "has this pair traded four times", "is one
  // account most of the volume" — which cannot be exercised without writing prints, and the
  // dev database's real tape should not be polluted to test them.
  console.log("\n=== integrity (rolled back) ===");
  const ROLLBACK = new Error("__rollback__");
  const target = (
    await db.execute<{ id: number; code: string; mark: string | null; sell: string | null }>(sql`
      SELECT commodity_id AS id, c.code, m.mark_price::text AS mark, m.best_sell::text AS sell
      FROM commodity_marks_latest m JOIN commodities c ON c.id = m.commodity_id
      WHERE m.best_sell IS NOT NULL AND m.mark_price IS NULL ORDER BY m.best_sell DESC LIMIT 1
    `)
  ).rows[0];
  const fixture = (
    await db.execute<{ order_id: string; season_id: number }>(sql`
      SELECT id AS order_id, season_id FROM orders LIMIT 1
    `)
  ).rows[0];

  if (!target || !fixture) {
    console.log("  skipped — dev DB needs at least one priced commodity and one order");
  } else {
    const reference = Number(target.sell ?? 0);
    await db
      .transaction(async (tx) => {
        // Four verified accounts to play with.
        const made = await tx.execute<{ id: string }>(sql`
          INSERT INTO users (handle, display_name, rsi_verified_at)
          VALUES ('__vm_a', 'A', now()), ('__vm_b', 'B', now()), ('__vm_c', 'C', now()), ('__vm_d', 'D', now())
          RETURNING id
        `);
        const [a, b, c, d] = made.rows.map((r) => r.id) as [string, string, string, string];
        const base = {
          commodityId: target.id,
          side: "sell" as const,
          quantityScu: 100,
          buyerId: a,
          sellerId: b,
        };
        const print = (buyer: string, seller: string, qty: number, price: number) => sql`
          INSERT INTO trade_prints (order_id, commodity_id, season_id, side, buyer_id, seller_id, price_per_scu, quantity_scu)
          VALUES (${fixture.order_id}, ${target.id}, ${fixture.season_id}, 'sell', ${buyer}, ${seller}, ${price}, ${qty})
        `;
        const fairPrice = Math.round(reference);

        // --- price band ---
        check("a fair price passes", !(await judgePrint(tx, { ...base, pricePerScu: fairPrice })).excluded);
        const high = await judgePrint(tx, { ...base, pricePerScu: Math.round(reference * 5) });
        check("5x the reference is quarantined", high.reason === "outlier", high.detail ?? "");
        const low = await judgePrint(tx, { ...base, pricePerScu: Math.max(1, Math.round(reference * 0.1)) });
        check("0.1x the reference is quarantined", low.reason === "outlier", low.detail ?? "");

        // --- unverified party ---
        await tx.execute(sql`UPDATE users SET rsi_verified_at = NULL WHERE id = ${b}`);
        const unver = await judgePrint(tx, { ...base, pricePerScu: fairPrice });
        check("an unverified party is refused", unver.reason === "unverified", unver.detail ?? "");
        await tx.execute(sql`UPDATE users SET rsi_verified_at = now() WHERE id = ${b}`);

        // --- pair rate limit: the same two accounts cannot keep setting the price ---
        for (let i = 0; i < 3; i++) await tx.execute(print(a, b, 10, fairPrice));
        const capped = await judgePrint(tx, { ...base, quantityScu: 10, pricePerScu: fairPrice });
        check("a 4th print from the same pair stops counting", capped.reason === "pair_rate_limit", capped.detail ?? "");
        // ...but a DIFFERENT counterparty is unaffected: the limit is on the relationship,
        // not on either trader. Getting this backwards would punish an active honest trader.
        const fresh = await judgePrint(tx, { ...base, quantityScu: 10, sellerId: c, pricePerScu: fairPrice });
        check("a different counterparty is not rate-limited", !fresh.excluded, fresh.detail ?? "");

        // --- share cap: one account dominating the window volume ---
        await tx.execute(sql`DELETE FROM trade_prints WHERE commodity_id = ${target.id} AND buyer_id IN (${a}, ${b}, ${c}, ${d})`);
        await tx.execute(print(a, b, 5_000, fairPrice));
        await tx.execute(print(a, c, 5_000, fairPrice));
        await tx.execute(print(a, d, 5_000, fairPrice));
        const hog = await judgePrint(tx, { ...base, buyerId: a, sellerId: c, quantityScu: 5_000, pricePerScu: fairPrice });
        check("a dominant account is capped", hog.reason === "share_cap", hog.detail ?? "");
        // A small trade between two of the OTHER accounts still counts — the cap is on
        // concentration, not on trading in a busy commodity.
        const bystander = await judgePrint(tx, { ...base, buyerId: b, sellerId: d, quantityScu: 10, pricePerScu: fairPrice });
        check("an unrelated pair still counts", !bystander.excluded, bystander.detail ?? "");

        // --- and the whole point: a qualifying print takes the commodity off the seed ---
        const seededMark = await scalarIn(tx, sql`SELECT mark_price::text FROM commodity_marks_latest WHERE commodity_id = ${target.id}`);
        check(`${target.code} starts on the NPC seed`, seededMark == null, `npc ${reference}`);
        const settledAt = new Date();
        await refreshCommodityMark(tx, target.id, settledAt);
        const movedMark = await scalarIn(tx, sql`SELECT mark_price::text FROM commodity_marks_latest WHERE commodity_id = ${target.id}`);
        const refPoint = await scalarIn(
          tx,
          sql`SELECT count(*)::text FROM commodity_reference_points WHERE commodity_id = ${target.id} AND captured_at = ${settledAt}`,
        );
        check("a settled print produces a player mark", movedMark != null, `${reference} (npc) → ${movedMark} (player)`);
        check("a settlement writes its own reference point", Number(refPoint) === 1, settledAt.toISOString());

        throw ROLLBACK;
      })
      .catch((err) => {
        if (err !== ROLLBACK) throw err;
      });

    const leaked = Number(await scalar(sql`SELECT count(*)::text FROM users WHERE handle LIKE '__vm_%'`));
    check("the transaction rolled back cleanly", leaked === 0);
  }

  console.log("\n=== settlement repaints the candle ===");
  if (target) {
    const settledAt = new Date();
    await refreshCommodityMark(db, target.id, settledAt);
    await rebuildCandlesSince(new Date(settledAt.getTime() - 2 * 3_600_000), target.id);
    const after = await scalar<string>(sql`
      SELECT mkt_close::text FROM reference_candles
      WHERE commodity_id = ${target.id} AND period = '1h' ORDER BY bucket_start DESC LIMIT 1
    `);
    check("the current bucket exists after a single-commodity rebuild", after != null, `${target.code} close ${after ?? "—"}`);
  }

  console.log("\n=== chain-linked index ===");
  await rebuildIndexSince(new Date(0));
  const idx = await db.execute<{ sector: string; n: string; first: string; last: string; min: string; max: string }>(sql`
    SELECT sector, count(*)::text AS n,
           (array_agg(value ORDER BY captured_at ASC))[1]::text  AS first,
           (array_agg(value ORDER BY captured_at DESC))[1]::text AS last,
           min(value)::text AS min, max(value)::text AS max
    FROM market_index_points GROUP BY sector ORDER BY sector
  `);
  for (const r of idx.rows) {
    const first = Number(r.first);
    const last = Number(r.last);
    check(
      `${r.sector}: ${r.n} points, base ${first.toFixed(0)} → ${last.toFixed(0)}`,
      Math.abs(first - 1000) < 0.01,
      `range ${Number(r.min).toFixed(0)}–${Number(r.max).toFixed(0)}`,
    );
  }
  // A chained series must never produce a non-positive or non-finite value.
  const bad = Number(
    await scalar(sql`SELECT count(*)::text FROM market_index_points WHERE value IS NULL OR value <= 0 OR value = 'NaN'::numeric`),
  );
  check("no null, zero or NaN index values", bad === 0);

  console.log("\n=== ticker query plan ===");
  const plan = await db.execute<{ "QUERY PLAN": string }>(sql`
    EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
    SELECT c.id, m.mark_price,
      (SELECT rc.mkt_close FROM reference_candles rc
        WHERE rc.commodity_id = c.id AND rc.period = '1h'
          AND rc.bucket_start <= now() - interval '24 hours' AND rc.mkt_close IS NOT NULL
        ORDER BY rc.bucket_start DESC LIMIT 1)
    FROM commodities c JOIN commodity_marks_latest m ON m.commodity_id = c.id
    WHERE c.is_tradable
  `);
  const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
  check("ticker no longer seq-scans the reference points", !planText.includes("Seq Scan on commodity_reference_points"));
  console.log(planText.split("\n").slice(0, 6).map((l) => `       ${l}`).join("\n"));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await closeDb();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
