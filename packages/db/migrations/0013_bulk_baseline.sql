ALTER TABLE "commodity_marks_latest" ADD COLUMN "bulk_buy" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "commodity_marks_latest" ADD COLUMN "bulk_buy_terminal" text;--> statement-breakpoint
ALTER TABLE "commodity_marks_latest" ADD COLUMN "bulk_buy_system" text;--> statement-breakpoint
ALTER TABLE "commodity_marks_latest" ADD COLUMN "bulk_sell" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "commodity_marks_latest" ADD COLUMN "bulk_sell_terminal" text;--> statement-breakpoint
ALTER TABLE "commodity_marks_latest" ADD COLUMN "bulk_sell_system" text;--> statement-breakpoint
-- Backfill so the bulk figures are present immediately rather than blank for up to 30
-- minutes. Threshold kept in sync with BULK_SCU_THRESHOLD in queries/market-point.ts.
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
    min(nullif(price_buy, 0))  FILTER (WHERE coalesce(scu_buy, 0)  >= 100) AS bulk_buy,
    max(nullif(price_sell, 0)) FILTER (WHERE coalesce(scu_sell, 0) >= 100) AS bulk_sell,
    (array_agg(terminal_id ORDER BY nullif(price_buy, 0) ASC)
       FILTER (WHERE nullif(price_buy, 0) IS NOT NULL AND coalesce(scu_buy, 0) >= 100))[1]   AS buy_terminal_id,
    (array_agg(terminal_id ORDER BY nullif(price_sell, 0) DESC)
       FILTER (WHERE nullif(price_sell, 0) IS NOT NULL AND coalesce(scu_sell, 0) >= 100))[1] AS sell_terminal_id
  FROM terminal_prices_latest
  GROUP BY commodity_id
)
UPDATE commodity_marks_latest m
SET bulk_buy           = b.bulk_buy,
    bulk_buy_terminal  = tb.name,
    bulk_buy_system    = tb.system_name,
    bulk_sell          = b.bulk_sell,
    bulk_sell_terminal = ts.name,
    bulk_sell_system   = ts.system_name
FROM best b
LEFT JOIN term tb ON tb.id = b.buy_terminal_id
LEFT JOIN term ts ON ts.id = b.sell_terminal_id
WHERE m.commodity_id = b.commodity_id;