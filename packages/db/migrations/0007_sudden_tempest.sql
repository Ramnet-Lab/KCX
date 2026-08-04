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
ALTER TABLE "contract_breaches" ADD CONSTRAINT "contract_breaches_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_breaches" ADD CONSTRAINT "contract_breaches_accused_id_users_id_fk" FOREIGN KEY ("accused_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_breaches" ADD CONSTRAINT "contract_breaches_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_breaches" ADD CONSTRAINT "contract_breaches_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_breaches_once" ON "contract_breaches" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_breaches_accused" ON "contract_breaches" USING btree ("accused_id","status");