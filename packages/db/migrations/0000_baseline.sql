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
CREATE TABLE "commodity_marks_latest" (
	"commodity_id" integer PRIMARY KEY NOT NULL,
	"best_sell" numeric(12, 2),
	"best_buy" numeric(12, 2),
	"best_sell_terminal" text,
	"best_sell_system" text,
	"best_buy_terminal" text,
	"best_buy_system" text,
	"bulk_buy" numeric(12, 2),
	"bulk_buy_terminal" text,
	"bulk_buy_system" text,
	"bulk_sell" numeric(12, 2),
	"bulk_sell_terminal" text,
	"bulk_sell_system" text,
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
	"trade_id" uuid,
	"commodity_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"side" text NOT NULL,
	"buyer_id" uuid,
	"seller_id" uuid,
	"price_per_scu" bigint NOT NULL,
	"quantity_scu" integer NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"exclusion_reason" text,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_ratings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trade_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"rated_id" uuid NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_ratings_stars_range" CHECK ("trade_ratings"."stars" BETWEEN 1 AND 5)
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
	"password_hash" text,
	"role" text DEFAULT 'user' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"rsi_verified_at" timestamp with time zone,
	"enlisted_at" timestamp with time zone,
	"citizen_record" text,
	"main_org_sid" text,
	"avatar_url" text,
	"auec_balance" bigint DEFAULT 0 NOT NULL,
	"banned_at" timestamp with time zone,
	"banned_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_handle_unique" UNIQUE("handle"),
	CONSTRAINT "users_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "user_inventory" (
	"user_id" uuid NOT NULL,
	"item_id" bigint NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_inventory_user_id_item_id_pk" PRIMARY KEY("user_id","item_id"),
	CONSTRAINT "user_inventory_quantity_non_negative" CHECK ("user_inventory"."quantity" >= 0)
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
	"consumed_at" timestamp with time zone,
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
CREATE TABLE "contract_bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_bids_amount_positive" CHECK ("contract_bids"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "contract_breaches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"accused_id" uuid NOT NULL,
	"reported_by_id" uuid NOT NULL,
	"status" text DEFAULT 'reported' NOT NULL,
	"reason" text NOT NULL,
	"response" text,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_ratings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"rated_id" uuid NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_ratings_stars_range" CHECK ("contract_ratings"."stars" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "service_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_id" uuid NOT NULL,
	"org_id" uuid,
	"executor_id" uuid,
	"season_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'other' NOT NULL,
	"payout" bigint NOT NULL,
	"location_id" integer,
	"pricing_mode" text DEFAULT 'fixed' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"bids_close_at" timestamp with time zone,
	"award_response_hours" integer,
	"awarded_to_id" uuid,
	"awarded_amount" bigint,
	"award_expires_at" timestamp with time zone,
	"image_filename" text,
	"status" text DEFAULT 'open' NOT NULL,
	"issuer_confirmed_at" timestamp with time zone,
	"executor_confirmed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_payout_positive" CHECK ("service_contracts"."payout" > 0),
	CONSTRAINT "contracts_award_within_ceiling" CHECK ("service_contracts"."awarded_amount" IS NULL OR "service_contracts"."awarded_amount" <= "service_contracts"."payout"),
	CONSTRAINT "contracts_award_positive" CHECK ("service_contracts"."awarded_amount" IS NULL OR "service_contracts"."awarded_amount" > 0),
	CONSTRAINT "contracts_bid_mode_has_window" CHECK (("service_contracts"."pricing_mode" = 'bid') = ("service_contracts"."bids_close_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "org_channel_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_a_id" uuid NOT NULL,
	"org_b_id" uuid NOT NULL,
	"opened_by_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"a_read_at" timestamp with time zone,
	"b_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_channels_distinct" CHECK ("org_channels"."org_a_id" <> "org_channels"."org_b_id"),
	CONSTRAINT "org_channels_ordered" CHECK ("org_channels"."org_a_id" < "org_channels"."org_b_id")
);
--> statement-breakpoint
CREATE TABLE "org_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_id" uuid,
	"subject_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"rsi_rank" text,
	"rsi_rank_stars" smallint,
	"is_board_member" boolean DEFAULT false NOT NULL,
	"spend_limit" bigint,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_limit_positive" CHECK ("org_members"."spend_limit" IS NULL OR "org_members"."spend_limit" >= 0),
	CONSTRAINT "org_members_stars_range" CHECK ("org_members"."rsi_rank_stars" IS NULL OR "org_members"."rsi_rank_stars" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "org_proposal_approvals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"approve" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"proposed_by_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"required_approvals" smallint NOT NULL,
	"result_ref" text,
	"failure_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_proposals_value_non_negative" CHECK ("org_proposals"."value" >= 0),
	CONSTRAINT "org_proposals_required_positive" CHECK ("org_proposals"."required_approvals" > 0)
);
--> statement-breakpoint
CREATE TABLE "org_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"claimant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sid" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'derived' NOT NULL,
	"charter_holder_id" uuid,
	"verified_at" timestamp with time zone,
	"verified_by_mod_id" uuid,
	"suspended_reason" text,
	"logo_filename" text,
	"profile_fetched_at" timestamp with time zone,
	"treasury" bigint DEFAULT 0 NOT NULL,
	"description" text,
	"board_threshold" smallint DEFAULT 0 NOT NULL,
	"board_min_value" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_treasury_non_negative" CHECK ("orgs"."treasury" >= 0),
	CONSTRAINT "orgs_board_threshold_range" CHECK ("orgs"."board_threshold" BETWEEN 0 AND 10),
	CONSTRAINT "orgs_board_min_non_negative" CHECK ("orgs"."board_min_value" >= 0),
	CONSTRAINT "orgs_status_matches_holder" CHECK (("orgs"."status" = 'verified' AND "orgs"."charter_holder_id" IS NOT NULL)
          OR ("orgs"."status" IN ('derived','pending') AND "orgs"."charter_holder_id" IS NULL)
          OR "orgs"."status" = 'suspended')
);
--> statement-breakpoint
CREATE TABLE "market_maker_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"commodity_id" integer NOT NULL,
	"bid_price" bigint NOT NULL,
	"ask_price" bigint NOT NULL,
	"bid_size_scu" integer NOT NULL,
	"ask_size_scu" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"active_minutes" integer DEFAULT 0 NOT NULL,
	"committed_since" timestamp with time zone,
	"fills_honoured" integer DEFAULT 0 NOT NULL,
	"scu_honoured" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maker_quotes_prices_positive" CHECK ("market_maker_quotes"."bid_price" > 0 AND "market_maker_quotes"."ask_price" > 0),
	CONSTRAINT "maker_quotes_sizes_positive" CHECK ("market_maker_quotes"."bid_size_scu" > 0 AND "market_maker_quotes"."ask_size_scu" > 0),
	CONSTRAINT "maker_quotes_not_crossed" CHECK ("market_maker_quotes"."ask_price" > "market_maker_quotes"."bid_price")
);
--> statement-breakpoint
CREATE TABLE "bazaar_bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bazaar_bids_amount_positive" CHECK ("bazaar_bids"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "bazaar_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"sale_id" uuid,
	"actor_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bazaar_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" integer,
	"uuid" text,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"section" text,
	"category" text,
	"company_name" text,
	"slug" text,
	"game_version" text,
	"created_by_id" uuid,
	"listing_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bazaar_listing_components" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"item_id" bigint NOT NULL,
	"slot_label" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"sort_index" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "bazaar_components_quantity_positive" CHECK ("bazaar_listing_components"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "bazaar_listing_images" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"sort_index" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bazaar_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent" text DEFAULT 'sell' NOT NULL,
	"item_id" bigint,
	"seller_id" uuid NOT NULL,
	"org_id" uuid,
	"season_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'other' NOT NULL,
	"listing_type" text DEFAULT 'buy_now' NOT NULL,
	"buy_now_price" bigint,
	"start_price" bigint,
	"current_bid" bigint,
	"current_bidder_id" uuid,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"auction_ends_at" timestamp with time zone,
	"quantity" integer DEFAULT 1 NOT NULL,
	"remaining_quantity" integer DEFAULT 1 NOT NULL,
	"location_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"bumped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bazaar_quantity_positive" CHECK ("bazaar_listings"."quantity" > 0),
	CONSTRAINT "bazaar_remaining_in_range" CHECK ("bazaar_listings"."remaining_quantity" >= 0 AND "bazaar_listings"."remaining_quantity" <= "bazaar_listings"."quantity"),
	CONSTRAINT "bazaar_buy_now_positive" CHECK ("bazaar_listings"."buy_now_price" IS NULL OR "bazaar_listings"."buy_now_price" > 0),
	CONSTRAINT "bazaar_start_price_positive" CHECK ("bazaar_listings"."start_price" IS NULL OR "bazaar_listings"."start_price" > 0),
	CONSTRAINT "bazaar_pricing_present" CHECK (("bazaar_listings"."listing_type" = 'auction') = ("bazaar_listings"."buy_now_price" IS NULL)),
	CONSTRAINT "bazaar_auction_has_clock" CHECK (("bazaar_listings"."listing_type" IN ('auction','auction_buy_now')) = ("bazaar_listings"."auction_ends_at" IS NOT NULL)),
	CONSTRAINT "bazaar_auction_single_lot" CHECK ("bazaar_listings"."listing_type" = 'buy_now' OR "bazaar_listings"."quantity" = 1),
	CONSTRAINT "bazaar_wtb_is_fixed" CHECK ("bazaar_listings"."intent" = 'sell' OR "bazaar_listings"."listing_type" = 'buy_now')
);
--> statement-breakpoint
CREATE TABLE "bazaar_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid,
	"kind" text DEFAULT 'message' NOT NULL,
	"body" text,
	"offer_unit_price" bigint,
	"offer_quantity" integer,
	"offer_status" text,
	"sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bazaar_messages_offer_shape" CHECK (("bazaar_messages"."kind" = 'offer') = ("bazaar_messages"."offer_unit_price" IS NOT NULL AND "bazaar_messages"."offer_status" IS NOT NULL)),
	CONSTRAINT "bazaar_messages_offer_positive" CHECK ("bazaar_messages"."offer_unit_price" IS NULL OR "bazaar_messages"."offer_unit_price" > 0),
	CONSTRAINT "bazaar_messages_offer_qty" CHECK ("bazaar_messages"."offer_quantity" IS NULL OR "bazaar_messages"."offer_quantity" > 0),
	CONSTRAINT "bazaar_messages_not_empty" CHECK ("bazaar_messages"."body" IS NOT NULL OR "bazaar_messages"."offer_unit_price" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "bazaar_ratings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sale_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"rated_id" uuid NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bazaar_ratings_stars_range" CHECK ("bazaar_ratings"."stars" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "bazaar_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_org_id" uuid,
	"buyer_org_id" uuid,
	"season_id" integer NOT NULL,
	"origin" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" bigint NOT NULL,
	"total_price" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"seller_confirmed_at" timestamp with time zone,
	"buyer_confirmed_at" timestamp with time zone,
	"cancelled_by_id" uuid,
	"settle_by" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "bazaar_sales_quantity_positive" CHECK ("bazaar_sales"."quantity" > 0),
	CONSTRAINT "bazaar_sales_price_positive" CHECK ("bazaar_sales"."unit_price" > 0 AND "bazaar_sales"."total_price" > 0),
	CONSTRAINT "bazaar_sales_distinct_parties" CHECK ("bazaar_sales"."seller_id" <> "bazaar_sales"."buyer_id")
);
--> statement-breakpoint
CREATE TABLE "bazaar_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_read_at" timestamp with time zone,
	"counterparty_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bazaar_threads_distinct_parties" CHECK ("bazaar_threads"."owner_id" <> "bazaar_threads"."counterparty_id")
);
--> statement-breakpoint
CREATE TABLE "instalment_defaults" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"paid_instalments" integer NOT NULL,
	"total_instalments" integer NOT NULL,
	"amount_paid" bigint NOT NULL,
	"amount_outstanding" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instalment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"proposed_by_id" uuid NOT NULL,
	"principal" bigint NOT NULL,
	"base_rate_bps" integer DEFAULT 0 NOT NULL,
	"effective_rate_bps" integer DEFAULT 0 NOT NULL,
	"interest_amount" bigint DEFAULT 0 NOT NULL,
	"total_amount" bigint NOT NULL,
	"instalment_count" smallint NOT NULL,
	"interval_days" smallint NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"defaulted_at" timestamp with time zone,
	"cancelled_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instalment_plans_total_positive" CHECK ("instalment_plans"."total_amount" > 0),
	CONSTRAINT "instalment_plans_count_range" CHECK ("instalment_plans"."instalment_count" BETWEEN 2 AND 24),
	CONSTRAINT "instalment_plans_principal_positive" CHECK ("instalment_plans"."principal" > 0),
	CONSTRAINT "instalment_plans_rates_non_negative" CHECK ("instalment_plans"."base_rate_bps" >= 0 AND "instalment_plans"."effective_rate_bps" >= 0),
	CONSTRAINT "instalment_plans_interest_non_negative" CHECK ("instalment_plans"."interest_amount" >= 0),
	CONSTRAINT "instalment_plans_total_is_sum" CHECK ("instalment_plans"."total_amount" = "instalment_plans"."principal" + "instalment_plans"."interest_amount"),
	CONSTRAINT "instalment_plans_interval_range" CHECK ("instalment_plans"."interval_days" BETWEEN 1 AND 30),
	CONSTRAINT "instalment_plans_distinct_parties" CHECK ("instalment_plans"."buyer_id" <> "instalment_plans"."seller_id")
);
--> statement-breakpoint
CREATE TABLE "instalments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"sequence" smallint NOT NULL,
	"amount" bigint NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"buyer_confirmed_at" timestamp with time zone,
	"seller_confirmed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instalments_amount_positive" CHECK ("instalments"."amount" > 0),
	CONSTRAINT "instalments_sequence_positive" CHECK ("instalments"."sequence" > 0)
);
--> statement-breakpoint
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
CREATE TABLE "moderation_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"moderator_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"target_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commodity_marks_latest" ADD CONSTRAINT "commodity_marks_latest_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_season_id_game_versions_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_prints" ADD CONSTRAINT "trade_prints_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_ratings" ADD CONSTRAINT "trade_ratings_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_ratings" ADD CONSTRAINT "trade_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_ratings" ADD CONSTRAINT "trade_ratings_rated_id_users_id_fk" FOREIGN KEY ("rated_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_claimer_id_users_id_fk" FOREIGN KEY ("claimer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_season_id_game_versions_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_holdings" ADD CONSTRAINT "user_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_holdings" ADD CONSTRAINT "user_holdings_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_inventory" ADD CONSTRAINT "user_inventory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_inventory" ADD CONSTRAINT "user_inventory_item_id_bazaar_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."bazaar_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsi_verifications" ADD CONSTRAINT "rsi_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_bids" ADD CONSTRAINT "contract_bids_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_bids" ADD CONSTRAINT "contract_bids_bidder_id_users_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_breaches" ADD CONSTRAINT "contract_breaches_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_breaches" ADD CONSTRAINT "contract_breaches_accused_id_users_id_fk" FOREIGN KEY ("accused_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_breaches" ADD CONSTRAINT "contract_breaches_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_breaches" ADD CONSTRAINT "contract_breaches_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_ratings" ADD CONSTRAINT "contract_ratings_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_ratings" ADD CONSTRAINT "contract_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_ratings" ADD CONSTRAINT "contract_ratings_rated_id_users_id_fk" FOREIGN KEY ("rated_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_issuer_id_users_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_executor_id_users_id_fk" FOREIGN KEY ("executor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_season_id_game_versions_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_awarded_to_id_users_id_fk" FOREIGN KEY ("awarded_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_channel_messages" ADD CONSTRAINT "org_channel_messages_channel_id_org_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."org_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_channel_messages" ADD CONSTRAINT "org_channel_messages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_channel_messages" ADD CONSTRAINT "org_channel_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_channels" ADD CONSTRAINT "org_channels_org_a_id_orgs_id_fk" FOREIGN KEY ("org_a_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_channels" ADD CONSTRAINT "org_channels_org_b_id_orgs_id_fk" FOREIGN KEY ("org_b_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_channels" ADD CONSTRAINT "org_channels_opened_by_id_users_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_proposal_approvals" ADD CONSTRAINT "org_proposal_approvals_proposal_id_org_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."org_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_proposal_approvals" ADD CONSTRAINT "org_proposal_approvals_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_proposals" ADD CONSTRAINT "org_proposals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_proposals" ADD CONSTRAINT "org_proposals_proposed_by_id_users_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_verifications" ADD CONSTRAINT "org_verifications_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_verifications" ADD CONSTRAINT "org_verifications_claimant_id_users_id_fk" FOREIGN KEY ("claimant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_charter_holder_id_users_id_fk" FOREIGN KEY ("charter_holder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_verified_by_mod_id_users_id_fk" FOREIGN KEY ("verified_by_mod_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_maker_quotes" ADD CONSTRAINT "market_maker_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_maker_quotes" ADD CONSTRAINT "market_maker_quotes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_maker_quotes" ADD CONSTRAINT "market_maker_quotes_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_bids" ADD CONSTRAINT "bazaar_bids_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_bids" ADD CONSTRAINT "bazaar_bids_bidder_id_users_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_events" ADD CONSTRAINT "bazaar_events_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_events" ADD CONSTRAINT "bazaar_events_sale_id_bazaar_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."bazaar_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_events" ADD CONSTRAINT "bazaar_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_items" ADD CONSTRAINT "bazaar_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listing_components" ADD CONSTRAINT "bazaar_listing_components_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listing_components" ADD CONSTRAINT "bazaar_listing_components_item_id_bazaar_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."bazaar_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listing_images" ADD CONSTRAINT "bazaar_listing_images_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_item_id_bazaar_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."bazaar_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_season_id_game_versions_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_current_bidder_id_users_id_fk" FOREIGN KEY ("current_bidder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_messages" ADD CONSTRAINT "bazaar_messages_thread_id_bazaar_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."bazaar_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_messages" ADD CONSTRAINT "bazaar_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_messages" ADD CONSTRAINT "bazaar_messages_sale_id_bazaar_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."bazaar_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_ratings" ADD CONSTRAINT "bazaar_ratings_sale_id_bazaar_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."bazaar_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_ratings" ADD CONSTRAINT "bazaar_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_ratings" ADD CONSTRAINT "bazaar_ratings_rated_id_users_id_fk" FOREIGN KEY ("rated_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_seller_org_id_orgs_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_buyer_org_id_orgs_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_season_id_game_versions_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_threads" ADD CONSTRAINT "bazaar_threads_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_threads" ADD CONSTRAINT "bazaar_threads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_threads" ADD CONSTRAINT "bazaar_threads_counterparty_id_users_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_defaults" ADD CONSTRAINT "instalment_defaults_plan_id_instalment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."instalment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_defaults" ADD CONSTRAINT "instalment_defaults_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_defaults" ADD CONSTRAINT "instalment_defaults_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_sale_id_bazaar_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."bazaar_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_proposed_by_id_users_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalments" ADD CONSTRAINT "instalments_plan_id_instalment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."instalment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_watchlist_id_watchlist_entries_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlist_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_entries" ADD CONSTRAINT "watchlist_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_entries" ADD CONSTRAINT "watchlist_entries_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_entries" ADD CONSTRAINT "watchlist_entries_item_id_bazaar_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."bazaar_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderator_id_users_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reference_points_time" ON "commodity_reference_points" USING btree ("captured_at");--> statement-breakpoint
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
CREATE INDEX "prints_pair" ON "trade_prints" USING btree ("commodity_id","buyer_id","seller_id","executed_at");--> statement-breakpoint
CREATE INDEX "prints_commodity_all" ON "trade_prints" USING btree ("commodity_id","executed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_ratings_once" ON "trade_ratings" USING btree ("trade_id","rater_id");--> statement-breakpoint
CREATE INDEX "trade_ratings_rated" ON "trade_ratings" USING btree ("rated_id");--> statement-breakpoint
CREATE INDEX "trades_order" ON "trades" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "trades_owner" ON "trades" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "trades_claimer" ON "trades" USING btree ("claimer_id","status");--> statement-breakpoint
CREATE INDEX "auth_events_user" ON "auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_user" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkeys_user" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rsi_verif_handle" ON "rsi_verifications" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "rsi_verif_pending" ON "rsi_verifications" USING btree ("handle") WHERE "rsi_verifications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "webauthn_challenge_lookup" ON "webauthn_challenges" USING btree ("challenge");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_bids_one_per_bidder" ON "contract_bids" USING btree ("contract_id","bidder_id");--> statement-breakpoint
CREATE INDEX "contract_bids_ranking" ON "contract_bids" USING btree ("contract_id","amount","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_breaches_once" ON "contract_breaches" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_breaches_accused" ON "contract_breaches" USING btree ("accused_id","status");--> statement-breakpoint
CREATE INDEX "contract_events_contract" ON "contract_events" USING btree ("contract_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_ratings_once" ON "contract_ratings" USING btree ("contract_id","rater_id");--> statement-breakpoint
CREATE INDEX "contract_ratings_rated" ON "contract_ratings" USING btree ("rated_id");--> statement-breakpoint
CREATE INDEX "contracts_board" ON "service_contracts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "contracts_issuer" ON "service_contracts" USING btree ("issuer_id","status");--> statement-breakpoint
CREATE INDEX "contracts_executor" ON "service_contracts" USING btree ("executor_id","status");--> statement-breakpoint
CREATE INDEX "contracts_bids_close" ON "service_contracts" USING btree ("bids_close_at");--> statement-breakpoint
CREATE INDEX "contracts_award_expiry" ON "service_contracts" USING btree ("award_expires_at");--> statement-breakpoint
CREATE INDEX "org_channel_messages_channel" ON "org_channel_messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_channels_pair" ON "org_channels" USING btree ("org_a_id","org_b_id");--> statement-breakpoint
CREATE INDEX "org_channels_a" ON "org_channels" USING btree ("org_a_id","last_message_at");--> statement-breakpoint
CREATE INDEX "org_channels_b" ON "org_channels" USING btree ("org_b_id","last_message_at");--> statement-breakpoint
CREATE INDEX "org_events_org" ON "org_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_once" ON "org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "org_members_user" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_members_rank" ON "org_members" USING btree ("org_id","rsi_rank_stars");--> statement-breakpoint
CREATE UNIQUE INDEX "org_proposal_approvals_once" ON "org_proposal_approvals" USING btree ("proposal_id","member_id");--> statement-breakpoint
CREATE INDEX "org_proposals_org" ON "org_proposals" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_verifications_live" ON "org_verifications" USING btree ("org_id") WHERE "org_verifications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "org_verifications_claimant" ON "org_verifications" USING btree ("claimant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_sid" ON "orgs" USING btree ("sid");--> statement-breakpoint
CREATE INDEX "orgs_status" ON "orgs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "maker_quotes_one_per_commodity" ON "market_maker_quotes" USING btree ("user_id","commodity_id");--> statement-breakpoint
CREATE INDEX "maker_quotes_commodity" ON "market_maker_quotes" USING btree ("commodity_id","status");--> statement-breakpoint
CREATE INDEX "maker_quotes_user" ON "market_maker_quotes" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_bids_one_per_bidder" ON "bazaar_bids" USING btree ("listing_id","bidder_id");--> statement-breakpoint
CREATE INDEX "bazaar_bids_ranking" ON "bazaar_bids" USING btree ("listing_id","amount","created_at");--> statement-breakpoint
CREATE INDEX "bazaar_bids_bidder" ON "bazaar_bids" USING btree ("bidder_id","status");--> statement-breakpoint
CREATE INDEX "bazaar_events_listing" ON "bazaar_events" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_items_key" ON "bazaar_items" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_items_source" ON "bazaar_items" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "bazaar_items_section" ON "bazaar_items" USING btree ("section","category");--> statement-breakpoint
CREATE INDEX "bazaar_items_popular" ON "bazaar_items" USING btree ("listing_count");--> statement-breakpoint
CREATE INDEX "bazaar_components_listing" ON "bazaar_listing_components" USING btree ("listing_id","sort_index");--> statement-breakpoint
CREATE INDEX "bazaar_components_item" ON "bazaar_listing_components" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "bazaar_images_listing" ON "bazaar_listing_images" USING btree ("listing_id","sort_index");--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_images_filename" ON "bazaar_listing_images" USING btree ("filename");--> statement-breakpoint
CREATE INDEX "bazaar_board" ON "bazaar_listings" USING btree ("status","bumped_at");--> statement-breakpoint
CREATE INDEX "bazaar_seller" ON "bazaar_listings" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "bazaar_category" ON "bazaar_listings" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "bazaar_listings_item" ON "bazaar_listings" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "bazaar_auction_end" ON "bazaar_listings" USING btree ("auction_ends_at");--> statement-breakpoint
CREATE INDEX "bazaar_expiry" ON "bazaar_listings" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "bazaar_messages_thread" ON "bazaar_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "bazaar_messages_open_offer" ON "bazaar_messages" USING btree ("thread_id") WHERE "bazaar_messages"."offer_status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_ratings_once" ON "bazaar_ratings" USING btree ("sale_id","rater_id");--> statement-breakpoint
CREATE INDEX "bazaar_ratings_rated" ON "bazaar_ratings" USING btree ("rated_id");--> statement-breakpoint
CREATE INDEX "bazaar_sales_listing" ON "bazaar_sales" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "bazaar_sales_seller" ON "bazaar_sales" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "bazaar_sales_buyer" ON "bazaar_sales" USING btree ("buyer_id","status");--> statement-breakpoint
CREATE INDEX "bazaar_sales_settle_by" ON "bazaar_sales" USING btree ("settle_by") WHERE "bazaar_sales"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_threads_one_per_pair" ON "bazaar_threads" USING btree ("listing_id","counterparty_id");--> statement-breakpoint
CREATE INDEX "bazaar_threads_owner" ON "bazaar_threads" USING btree ("owner_id","last_message_at");--> statement-breakpoint
CREATE INDEX "bazaar_threads_counterparty" ON "bazaar_threads" USING btree ("counterparty_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "instalment_defaults_once" ON "instalment_defaults" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "instalment_defaults_buyer" ON "instalment_defaults" USING btree ("buyer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instalment_plans_one_per_sale" ON "instalment_plans" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "instalment_plans_buyer" ON "instalment_plans" USING btree ("buyer_id","status");--> statement-breakpoint
CREATE INDEX "instalment_plans_seller" ON "instalment_plans" USING btree ("seller_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "instalments_sequence" ON "instalments" USING btree ("plan_id","sequence");--> statement-breakpoint
CREATE INDEX "instalments_due" ON "instalments" USING btree ("due_at") WHERE "instalments"."status" IN ('due','buyer_confirmed');--> statement-breakpoint
CREATE INDEX "price_alerts_user" ON "price_alerts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "price_alerts_unread" ON "price_alerts" USING btree ("user_id") WHERE NOT "price_alerts"."read";--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_unique_commodity" ON "watchlist_entries" USING btree ("user_id","commodity_id") WHERE "watchlist_entries"."commodity_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_unique_item" ON "watchlist_entries" USING btree ("user_id","item_id") WHERE "watchlist_entries"."item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "watchlist_user" ON "watchlist_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watchlist_armed_commodity" ON "watchlist_entries" USING btree ("commodity_id") WHERE "watchlist_entries"."threshold" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "watchlist_armed_item" ON "watchlist_entries" USING btree ("item_id") WHERE "watchlist_entries"."threshold" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "moderation_actions_recent" ON "moderation_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_target_user" ON "moderation_actions" USING btree ("target_user_id","created_at");