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
ALTER TABLE "service_contracts" ADD COLUMN "pricing_mode" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "bids_close_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "award_response_hours" integer;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "awarded_to_id" uuid;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "awarded_amount" bigint;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD COLUMN "award_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_bids" ADD CONSTRAINT "contract_bids_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_bids" ADD CONSTRAINT "contract_bids_bidder_id_users_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_bids_one_per_bidder" ON "contract_bids" USING btree ("contract_id","bidder_id");--> statement-breakpoint
CREATE INDEX "contract_bids_ranking" ON "contract_bids" USING btree ("contract_id","amount","created_at");--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_awarded_to_id_users_id_fk" FOREIGN KEY ("awarded_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_bids_close" ON "service_contracts" USING btree ("bids_close_at");--> statement-breakpoint
CREATE INDEX "contracts_award_expiry" ON "service_contracts" USING btree ("award_expires_at");--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "contracts_award_within_ceiling" CHECK ("service_contracts"."awarded_amount" IS NULL OR "service_contracts"."awarded_amount" <= "service_contracts"."payout");--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "contracts_award_positive" CHECK ("service_contracts"."awarded_amount" IS NULL OR "service_contracts"."awarded_amount" > 0);--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "contracts_bid_mode_has_window" CHECK (("service_contracts"."pricing_mode" = 'bid') = ("service_contracts"."bids_close_at" IS NOT NULL));