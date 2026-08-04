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
ALTER TABLE "bazaar_listings" ADD COLUMN "item_id" bigint;--> statement-breakpoint
ALTER TABLE "bazaar_items" ADD CONSTRAINT "bazaar_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_items_key" ON "bazaar_items" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bazaar_items_source" ON "bazaar_items" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "bazaar_items_section" ON "bazaar_items" USING btree ("section","category");--> statement-breakpoint
CREATE INDEX "bazaar_items_popular" ON "bazaar_items" USING btree ("listing_count");--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_item_id_bazaar_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."bazaar_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bazaar_listings_item" ON "bazaar_listings" USING btree ("item_id","created_at");