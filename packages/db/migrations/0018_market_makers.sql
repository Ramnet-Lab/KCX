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
ALTER TABLE "market_maker_quotes" ADD CONSTRAINT "market_maker_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_maker_quotes" ADD CONSTRAINT "market_maker_quotes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_maker_quotes" ADD CONSTRAINT "market_maker_quotes_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maker_quotes_one_per_commodity" ON "market_maker_quotes" USING btree ("user_id","commodity_id");--> statement-breakpoint
CREATE INDEX "maker_quotes_commodity" ON "market_maker_quotes" USING btree ("commodity_id","status");--> statement-breakpoint
CREATE INDEX "maker_quotes_user" ON "market_maker_quotes" USING btree ("user_id","status");