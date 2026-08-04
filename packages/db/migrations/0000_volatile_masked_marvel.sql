CREATE TABLE "commodities" (
	"id" serial PRIMARY KEY NOT NULL,
	"uex_id" integer,
	"uex_uuid" text,
	"game_uuid" text,
	"code" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"sector" text DEFAULT 'MISC' NOT NULL,
	"tier" smallint,
	"weight_scu" numeric(10, 4),
	"is_illegal" boolean DEFAULT false NOT NULL,
	"is_raw" boolean DEFAULT false NOT NULL,
	"is_refined" boolean DEFAULT false NOT NULL,
	"is_tradable" boolean DEFAULT true NOT NULL,
	"retired_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commodities_uex_id_unique" UNIQUE("uex_id"),
	CONSTRAINT "commodities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "commodity_reference_points" (
	"commodity_id" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"best_sell" numeric(12, 2),
	"best_buy" numeric(12, 2),
	"sell_terminals" integer DEFAULT 0 NOT NULL,
	"buy_terminals" integer DEFAULT 0 NOT NULL,
	"market_price" numeric(14, 2),
	"print_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "commodity_reference_points_commodity_id_captured_at_pk" PRIMARY KEY("commodity_id","captured_at")
);
--> statement-breakpoint
CREATE TABLE "game_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"is_wipe" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"live_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "game_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"uex_id" integer NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" integer,
	"is_available" boolean DEFAULT true NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "locations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "market_index_points" (
	"sector" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"constituents" integer NOT NULL,
	CONSTRAINT "market_index_points_sector_captured_at_pk" PRIMARY KEY("sector","captured_at")
);
--> statement-breakpoint
CREATE TABLE "reference_candles" (
	"commodity_id" integer NOT NULL,
	"period" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"sell_open" numeric(12, 2),
	"sell_high" numeric(12, 2),
	"sell_low" numeric(12, 2),
	"sell_close" numeric(12, 2),
	"buy_open" numeric(12, 2),
	"buy_high" numeric(12, 2),
	"buy_low" numeric(12, 2),
	"buy_close" numeric(12, 2),
	"mkt_open" numeric(14, 2),
	"mkt_high" numeric(14, 2),
	"mkt_low" numeric(14, 2),
	"mkt_close" numeric(14, 2),
	"samples" integer NOT NULL,
	CONSTRAINT "reference_candles_commodity_id_period_bucket_start_pk" PRIMARY KEY("commodity_id","period","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "terminal_prices_latest" (
	"terminal_id" integer NOT NULL,
	"commodity_id" integer NOT NULL,
	"price_buy" numeric(12, 2),
	"price_buy_min" numeric(12, 2),
	"price_buy_max" numeric(12, 2),
	"price_buy_avg" numeric(12, 2),
	"price_sell" numeric(12, 2),
	"price_sell_min" numeric(12, 2),
	"price_sell_max" numeric(12, 2),
	"price_sell_avg" numeric(12, 2),
	"scu_buy" integer,
	"scu_sell" integer,
	"scu_sell_stock" integer,
	"status_buy" smallint,
	"status_sell" smallint,
	"source_score" integer,
	"game_version" text,
	"uex_date_modified" timestamp with time zone,
	"captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "terminal_prices_latest_terminal_id_commodity_id_pk" PRIMARY KEY("terminal_id","commodity_id")
);
--> statement-breakpoint
CREATE TABLE "terminals" (
	"id" serial PRIMARY KEY NOT NULL,
	"uex_id" integer,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"location_id" integer,
	"terminal_type" text,
	"is_available" boolean DEFAULT true NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terminals_uex_id_unique" UNIQUE("uex_id"),
	CONSTRAINT "terminals_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "uex_poll_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"rows_fetched" integer,
	"rows_upserted" integer,
	"status" text NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"season_id" integer NOT NULL,
	"commodity_id" integer NOT NULL,
	"side" text NOT NULL,
	"price_per_scu" bigint NOT NULL,
	"quantity_scu" integer NOT NULL,
	"remaining_scu" integer NOT NULL,
	"min_fill_scu" integer DEFAULT 1 NOT NULL,
	"location_id" integer,
	"location_flexible" boolean DEFAULT true NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bumped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"filled_scu" integer DEFAULT 0 NOT NULL,
	"filled_at" timestamp with time zone,
	"reserved_scu" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trade_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_prints" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"commodity_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"side" text NOT NULL,
	"price_per_scu" bigint NOT NULL,
	"quantity_scu" integer NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"exclusion_reason" text,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"claimer_id" uuid NOT NULL,
	"commodity_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"side" text NOT NULL,
	"quantity_scu" integer NOT NULL,
	"price_per_scu" bigint NOT NULL,
	"status" text DEFAULT 'escrow' NOT NULL,
	"owner_confirmed_at" timestamp with time zone,
	"claimer_confirmed_at" timestamp with time zone,
	"cancelled_by_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_holdings" (
	"user_id" uuid NOT NULL,
	"commodity_id" integer NOT NULL,
	"scu" integer NOT NULL,
	"avg_cost" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_holdings_user_id_commodity_id_pk" PRIMARY KEY("user_id","commodity_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"discord_id" text,
	"role" text DEFAULT 'user' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"rsi_verified_at" timestamp with time zone,
	"enlisted_at" timestamp with time zone,
	"citizen_record" text,
	"main_org_sid" text,
	"avatar_url" text,
	"auec_balance" bigint DEFAULT 0 NOT NULL,
	"banned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_handle_unique" UNIQUE("handle"),
	CONSTRAINT "users_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"handle" text,
	"type" text NOT NULL,
	"detail" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_hash" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text[],
	"device_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rsi_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"handle" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commodity_reference_points" ADD CONSTRAINT "commodity_reference_points_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_candles" ADD CONSTRAINT "reference_candles_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_prices_latest" ADD CONSTRAINT "terminal_prices_latest_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_prices_latest" ADD CONSTRAINT "terminal_prices_latest_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_season_id_game_versions_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_season_id_game_versions_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_claimer_id_users_id_fk" FOREIGN KEY ("claimer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_season_id_game_versions_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_holdings" ADD CONSTRAINT "user_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_holdings" ADD CONSTRAINT "user_holdings_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsi_verifications" ADD CONSTRAINT "rsi_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_season" ON "game_versions" USING btree ("status") WHERE "game_versions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "locations_type_uex" ON "locations" USING btree ("type","uex_id");--> statement-breakpoint
CREATE INDEX "locations_parent" ON "locations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tpl_commodity" ON "terminal_prices_latest" USING btree ("commodity_id");--> statement-breakpoint
CREATE INDEX "terminals_location" ON "terminals" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "order_events_order" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_board" ON "orders" USING btree ("commodity_id","side","price_per_scu") WHERE "orders"."status" = 'active';--> statement-breakpoint
CREATE INDEX "orders_owner" ON "orders" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "orders_season" ON "orders" USING btree ("season_id","status");--> statement-breakpoint
CREATE INDEX "trade_events_trade" ON "trade_events" USING btree ("trade_id","created_at");--> statement-breakpoint
CREATE INDEX "prints_commodity_time" ON "trade_prints" USING btree ("commodity_id","executed_at") WHERE NOT "trade_prints"."excluded";--> statement-breakpoint
CREATE INDEX "trades_order" ON "trades" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "trades_owner" ON "trades" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "trades_claimer" ON "trades" USING btree ("claimer_id","status");--> statement-breakpoint
CREATE INDEX "auth_events_user" ON "auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_user" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkeys_user" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rsi_verif_handle" ON "rsi_verifications" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "rsi_verif_pending" ON "rsi_verifications" USING btree ("handle") WHERE "rsi_verifications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "webauthn_challenge_lookup" ON "webauthn_challenges" USING btree ("challenge");