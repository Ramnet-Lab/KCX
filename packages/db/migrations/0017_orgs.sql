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
	"spend_limit" bigint,
	"invited_by_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_limit_positive" CHECK ("org_members"."spend_limit" IS NULL OR "org_members"."spend_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sid" text NOT NULL,
	"name" text NOT NULL,
	"treasury" bigint DEFAULT 0 NOT NULL,
	"description" text,
	"founded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_treasury_non_negative" CHECK ("orgs"."treasury" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD COLUMN "seller_org_id" uuid;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD COLUMN "buyer_org_id" uuid;--> statement-breakpoint
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_founded_by_id_users_id_fk" FOREIGN KEY ("founded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_events_org" ON "org_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_once" ON "org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "org_members_user" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_sid" ON "orgs" USING btree ("sid");--> statement-breakpoint
ALTER TABLE "bazaar_listings" ADD CONSTRAINT "bazaar_listings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_seller_org_id_orgs_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazaar_sales" ADD CONSTRAINT "bazaar_sales_buyer_org_id_orgs_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;