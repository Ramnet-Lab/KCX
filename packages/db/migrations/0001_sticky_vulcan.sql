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
ALTER TABLE "trade_ratings" ADD CONSTRAINT "trade_ratings_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_ratings" ADD CONSTRAINT "trade_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_ratings" ADD CONSTRAINT "trade_ratings_rated_id_users_id_fk" FOREIGN KEY ("rated_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_ratings_once" ON "trade_ratings" USING btree ("trade_id","rater_id");--> statement-breakpoint
CREATE INDEX "trade_ratings_rated" ON "trade_ratings" USING btree ("rated_id");