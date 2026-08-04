CREATE TABLE "price_alerts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"watchlist_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"price" bigint NOT NULL,
	"threshold" bigint NOT NULL,
	"direction" text NOT NULL,
	"href" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"target" text NOT NULL,
	"commodity_id" integer,
	"item_id" bigint,
	"threshold" bigint,
	"direction" text DEFAULT 'below' NOT NULL,
	"triggered_at" timestamp with time zone,
	"triggered_price" bigint,
	"acknowledged_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_exactly_one_target" CHECK (("watchlist_entries"."commodity_id" IS NOT NULL)::int + ("watchlist_entries"."item_id" IS NOT NULL)::int = 1),
	CONSTRAINT "watchlist_target_matches" CHECK (
      ("watchlist_entries"."target" = 'commodity' AND "watchlist_entries"."commodity_id" IS NOT NULL)
      OR ("watchlist_entries"."target" = 'item' AND "watchlist_entries"."item_id" IS NOT NULL)
    ),
	CONSTRAINT "watchlist_threshold_positive" CHECK ("watchlist_entries"."threshold" IS NULL OR "watchlist_entries"."threshold" > 0)
);
--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_watchlist_id_watchlist_entries_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlist_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_entries" ADD CONSTRAINT "watchlist_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_entries" ADD CONSTRAINT "watchlist_entries_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_entries" ADD CONSTRAINT "watchlist_entries_item_id_bazaar_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."bazaar_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_alerts_user" ON "price_alerts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "price_alerts_unread" ON "price_alerts" USING btree ("user_id") WHERE NOT "price_alerts"."read";--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_unique_commodity" ON "watchlist_entries" USING btree ("user_id","commodity_id") WHERE "watchlist_entries"."commodity_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_unique_item" ON "watchlist_entries" USING btree ("user_id","item_id") WHERE "watchlist_entries"."item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "watchlist_user" ON "watchlist_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watchlist_armed_commodity" ON "watchlist_entries" USING btree ("commodity_id") WHERE "watchlist_entries"."threshold" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "watchlist_armed_item" ON "watchlist_entries" USING btree ("item_id") WHERE "watchlist_entries"."threshold" IS NOT NULL;