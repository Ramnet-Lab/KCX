ALTER TABLE "commodity_marks_latest" ADD COLUMN "best_sell_terminal" text;--> statement-breakpoint
ALTER TABLE "commodity_marks_latest" ADD COLUMN "best_sell_system" text;--> statement-breakpoint
ALTER TABLE "commodity_marks_latest" ADD COLUMN "best_buy_terminal" text;--> statement-breakpoint
ALTER TABLE "commodity_marks_latest" ADD COLUMN "best_buy_system" text;--> statement-breakpoint
-- Backfill from the current terminal prices, so the labels are present immediately rather
-- than only after the next half-hourly capture. The site would otherwise spend up to 30
-- minutes showing NPC prices with the location blank, which is the exact ambiguity these
-- columns exist to remove.
WITH RECURSIVE roots AS (
  SELECT id, name AS system_name FROM locations WHERE parent_id IS NULL
  UNION ALL
  SELECT l.id, r.system_name FROM locations l JOIN roots r ON l.parent_id = r.id
),
term AS (
  SELECT t.id, t.name, r.system_name
  FROM terminals t LEFT JOIN roots r ON r.id = t.location_id
),
best AS (
  SELECT
    commodity_id,
    (array_agg(terminal_id ORDER BY nullif(price_sell, 0) DESC)
       FILTER (WHERE nullif(price_sell, 0) IS NOT NULL))[1] AS sell_terminal_id,
    (array_agg(terminal_id ORDER BY nullif(price_buy, 0) ASC)
       FILTER (WHERE nullif(price_buy, 0) IS NOT NULL))[1]  AS buy_terminal_id
  FROM terminal_prices_latest
  GROUP BY commodity_id
)
UPDATE commodity_marks_latest m
SET best_sell_terminal = ts.name,
    best_sell_system   = ts.system_name,
    best_buy_terminal  = tb.name,
    best_buy_system    = tb.system_name
FROM best b
LEFT JOIN term ts ON ts.id = b.sell_terminal_id
LEFT JOIN term tb ON tb.id = b.buy_terminal_id
WHERE m.commodity_id = b.commodity_id;