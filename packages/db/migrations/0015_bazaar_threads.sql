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
ALTER TABLE "bazaar_listings" ADD COLUMN "intent" text DEFAULT 'sell' NOT NULL;--> statement-breakpoint
ALTER TABLE "bazaar_listing_components" ADD CONSTRAINT "bazaar_listing_components_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_listing_components" ADD CONSTRAINT "bazaar_listing_components_item_id_bazaar_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."bazaar_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_messages" ADD CONSTRAINT "bazaar_messages_thread_id_bazaar_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."bazaar_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_messages" ADD CONSTRAINT "bazaar_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_messages" ADD CONSTRAINT "bazaar_messages_sale_id_bazaar_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."bazaar_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_threads" ADD CONSTRAINT "bazaar_threads_listing_id_bazaar_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."bazaar_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_threads" ADD CONSTRAINT "bazaar_threads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_threads" ADD CONSTRAINT "bazaar_threads_counterparty_id_users_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bazaar_components_listing" ON "bazaar_listing_components" USING btree ("listing_id","sort_index");--> statement-breakpoint
CREATE INDEX "bazaar_components_item" ON "bazaar_listing_components" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "bazaar_messages_thread" ON "bazaar_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "bazaar_messages_open_offer" ON "bazaar_messages" USING btree ("thread_id") WHERE "bazaar_messages"."offer_status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_threads_one_per_pair" ON "bazaar_threads" USING btree ("listing_id","counterparty_id");--> statement-breakpoint
CREATE INDEX "bazaar_threads_owner" ON "bazaar_threads" USING btree ("owner_id","last_message_at");--> statement-breakpoint
CREATE INDEX "bazaar_threads_counterparty" ON "bazaar_threads" USING btree ("counterparty_id","last_message_at");--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_wtb_is_fixed" CHECK ("bazaar_listings"."intent" = 'sell' OR "bazaar_listings"."listing_type" = 'buy_now');