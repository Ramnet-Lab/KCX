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
	"seller_id" uuid NOT NULL,
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
	CONSTRAINT "bazaar_auction_single_lot" CHECK ("bazaar_listings"."listing_type" = 'buy_now' OR "bazaar_listings"."quantity" = 1)
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
ALTER TABLE "bazaar_bids" ADD CONSTRAINT "bazaar_bids_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_bids" ADD CONSTRAINT "bazaar_bids_bidder_id_users_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_events" ADD CONSTRAINT "bazaar_events_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_events" ADD CONSTRAINT "bazaar_events_sale_id_bazaar_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."bazaar_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_events" ADD CONSTRAINT "bazaar_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listing_images" ADD CONSTRAINT "bazaar_listing_images_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_season_id_game_versions_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_current_bidder_id_users_id_fk" FOREIGN KEY ("current_bidder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_ratings" ADD CONSTRAINT "bazaar_ratings_sale_id_bazaar_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."bazaar_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_ratings" ADD CONSTRAINT "bazaar_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_ratings" ADD CONSTRAINT "bazaar_ratings_rated_id_users_id_fk" FOREIGN KEY ("rated_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_season_id_game_versions_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_bids_one_per_bidder" ON "bazaar_bids" USING btree ("listing_id","bidder_id");--> statement-breakpoint
CREATE INDEX "bazaar_bids_ranking" ON "bazaar_bids" USING btree ("listing_id","amount","created_at");--> statement-breakpoint
CREATE INDEX "bazaar_bids_bidder" ON "bazaar_bids" USING btree ("bidder_id","status");--> statement-breakpoint
CREATE INDEX "bazaar_events_listing" ON "bazaar_events" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX "bazaar_images_listing" ON "bazaar_listing_images" USING btree ("listing_id","sort_index");--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_images_filename" ON "bazaar_listing_images" USING btree ("filename");--> statement-breakpoint
CREATE INDEX "bazaar_board" ON "bazaar_listings" USING btree ("status","bumped_at");--> statement-breakpoint
CREATE INDEX "bazaar_seller" ON "bazaar_listings" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "bazaar_category" ON "bazaar_listings" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "bazaar_auction_end" ON "bazaar_listings" USING btree ("auction_ends_at");--> statement-breakpoint
CREATE INDEX "bazaar_expiry" ON "bazaar_listings" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_ratings_once" ON "bazaar_ratings" USING btree ("sale_id","rater_id");--> statement-breakpoint
CREATE INDEX "bazaar_ratings_rated" ON "bazaar_ratings" USING btree ("rated_id");--> statement-breakpoint
CREATE INDEX "bazaar_sales_listing" ON "bazaar_sales" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "bazaar_sales_seller" ON "bazaar_sales" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "bazaar_sales_buyer" ON "bazaar_sales" USING btree ("buyer_id","status");--> statement-breakpoint
CREATE INDEX "bazaar_sales_settle_by" ON "bazaar_sales" USING btree ("settle_by") WHERE "bazaar_sales"."status" = 'pending';