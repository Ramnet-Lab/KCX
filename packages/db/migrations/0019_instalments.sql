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
	CONSTRAINT "instalment_plans_count_range" CHECK ("instalment_plans"."instalment_count" BETWEEN 2 AND 12),
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
ALTER TABLE "instalment_defaults" ADD CONSTRAINT "instalment_defaults_plan_id_instalment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."instalment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_defaults" ADD CONSTRAINT "instalment_defaults_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_defaults" ADD CONSTRAINT "instalment_defaults_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_sale_id_bazaar_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."bazaar_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_proposed_by_id_users_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalment_plans" ADD CONSTRAINT "instalment_plans_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalments" ADD CONSTRAINT "instalments_plan_id_instalment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."instalment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instalment_defaults_once" ON "instalment_defaults" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "instalment_defaults_buyer" ON "instalment_defaults" USING btree ("buyer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instalment_plans_one_per_sale" ON "instalment_plans" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "instalment_plans_buyer" ON "instalment_plans" USING btree ("buyer_id","status");--> statement-breakpoint
CREATE INDEX "instalment_plans_seller" ON "instalment_plans" USING btree ("seller_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "instalments_sequence" ON "instalments" USING btree ("plan_id","sequence");--> statement-breakpoint
CREATE INDEX "instalments_due" ON "instalments" USING btree ("due_at") WHERE "instalments"."status" IN ('due','buyer_confirmed');