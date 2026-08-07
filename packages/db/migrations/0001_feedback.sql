CREATE TABLE "feature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" text DEFAULT 'idea' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_requests_title_length" CHECK (char_length("feature_requests"."title") BETWEEN 3 AND 120),
	CONSTRAINT "feature_requests_body_length" CHECK (char_length("feature_requests"."body") BETWEEN 5 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "user_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"sender_id" uuid,
	"kind" text DEFAULT 'system' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"request_id" uuid,
	"read_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_messages_subject_length" CHECK (char_length("user_messages"."subject") BETWEEN 1 AND 200),
	CONSTRAINT "user_messages_body_length" CHECK (char_length("user_messages"."body") BETWEEN 1 AND 4000),
	CONSTRAINT "user_messages_distinct_parties" CHECK ("user_messages"."sender_id" IS NULL OR "user_messages"."sender_id" <> "user_messages"."recipient_id")
);
--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_messages" ADD CONSTRAINT "user_messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_messages" ADD CONSTRAINT "user_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_messages" ADD CONSTRAINT "user_messages_request_id_feature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."feature_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_requests_queue" ON "feature_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "feature_requests_author" ON "feature_requests" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "user_messages_inbox" ON "user_messages" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "user_messages_unread" ON "user_messages" USING btree ("recipient_id") WHERE "user_messages"."read_at" IS NULL AND "user_messages"."deleted_at" IS NULL;