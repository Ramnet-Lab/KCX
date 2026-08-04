CREATE TABLE "commodity_marks_latest" (
	"commodity_id" integer PRIMARY KEY NOT NULL,
	"best_sell" numeric(12, 2),
	"best_buy" numeric(12, 2),
	"sell_terminals" integer DEFAULT 0 NOT NULL,
	"buy_terminals" integer DEFAULT 0 NOT NULL,
	"mark_price" numeric(14, 2),
	"last_price" bigint,
	"last_traded_at" timestamp with time zone,
	"window_volume_scu" bigint DEFAULT 0 NOT NULL,
	"window_print_count" integer DEFAULT 0 NOT NULL,
	"window_pairs" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trade_prints" ADD COLUMN "trade_id" uuid;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD COLUMN "buyer_id" uuid;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD COLUMN "seller_id" uuid;--> statement-breakpoint
ALTER TABLE "commodity_marks_latest" ADD CONSTRAINT "commodity_marks_latest_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reference_points_time" ON "commodity_reference_points" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "prints_pair" ON "trade_prints" USING btree ("commodity_id","buyer_id","seller_id","executed_at");--> statement-breakpoint
CREATE INDEX "prints_commodity_all" ON "trade_prints" USING btree ("commodity_id","executed_at");--> statement-breakpoint
-- Backfill commodity_marks_latest from the newest reference point plus the existing tape.
--
-- The ticker now JOINs this table, so without a backfill the site serves an empty market
-- between this migration and the next half-hourly capture. Boot only forces a catch-up
-- ingest when the held data is already stale, so "empty for up to 30 minutes" was a real
-- outcome, not a theoretical one.
--
-- Prints written before this migration carry no buyer/seller, so they contribute a last
-- price and volume but no counterparty pairs — which lands them on the right side of the
-- thin-market flag rather than pretending they were vetted.
INSERT INTO "commodity_marks_latest"
  (commodity_id, best_sell, best_buy, sell_terminals, buy_terminals,
   mark_price, last_price, last_traded_at, window_volume_scu, window_print_count, window_pairs, updated_at)
SELECT
  b.commodity_id, b.best_sell, b.best_buy, b.sell_terminals, b.buy_terminals,
  CASE
    WHEN coalesce(s.volume_scu, 0) >= 10 AND s.vwap IS NOT NULL THEN s.vwap
    ELSE s.last_price::numeric
  END,
  s.last_price, s.last_traded_at,
  coalesce(s.volume_scu, 0), coalesce(s.print_count, 0), coalesce(s.pairs, 0),
  b.captured_at
FROM (
  SELECT DISTINCT ON (commodity_id)
    commodity_id, captured_at, best_sell, best_buy, sell_terminals, buy_terminals
  FROM "commodity_reference_points"
  ORDER BY commodity_id, captured_at DESC
) b
LEFT JOIN (
  SELECT
    commodity_id,
    sum(price_per_scu::numeric * quantity_scu) FILTER (WHERE executed_at >= now() - interval '72 hours')
      / nullif(sum(quantity_scu) FILTER (WHERE executed_at >= now() - interval '72 hours'), 0) AS vwap,
    coalesce(sum(quantity_scu) FILTER (WHERE executed_at >= now() - interval '72 hours'), 0)   AS volume_scu,
    count(*) FILTER (WHERE executed_at >= now() - interval '72 hours')                         AS print_count,
    count(DISTINCT (least(buyer_id, seller_id), greatest(buyer_id, seller_id)))
      FILTER (WHERE executed_at >= now() - interval '72 hours'
                AND buyer_id IS NOT NULL AND seller_id IS NOT NULL)                            AS pairs,
    (array_agg(price_per_scu ORDER BY executed_at DESC, id DESC))[1]                           AS last_price,
    max(executed_at)                                                                           AS last_traded_at
  FROM "trade_prints"
  WHERE NOT excluded
  GROUP BY commodity_id
) s ON s.commodity_id = b.commodity_id
ON CONFLICT (commodity_id) DO NOTHING;