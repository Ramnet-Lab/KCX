ALTER TABLE "bazaar_listings" ADD COLUMN "archived_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "bazaar_listings_archived" ON "bazaar_listings" ("seller_id","archived_at");
