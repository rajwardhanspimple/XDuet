CREATE TABLE "agent_thread_events" (
	"run_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"seq" integer NOT NULL,
	"event_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_thread_events_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "agent_thread_locks" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"owner" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_thread_messages" (
	"thread_id" text NOT NULL,
	"id" text NOT NULL,
	"run_id" text,
	"role" text NOT NULL,
	"message_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_thread_messages_thread_id_id_pk" PRIMARY KEY("thread_id","id")
);
--> statement-breakpoint
CREATE TABLE "agent_thread_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"parent_run_id" text,
	"status" text NOT NULL,
	"input_json" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text,
	"archived" boolean DEFAULT false NOT NULL,
	"state_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_thread_events" ADD CONSTRAINT "agent_thread_events_run_id_agent_thread_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_thread_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thread_events" ADD CONSTRAINT "agent_thread_events_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thread_locks" ADD CONSTRAINT "agent_thread_locks_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thread_messages" ADD CONSTRAINT "agent_thread_messages_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thread_runs" ADD CONSTRAINT "agent_thread_runs_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_thread_events_thread_idx" ON "agent_thread_events" USING btree ("thread_id","run_id");--> statement-breakpoint
CREATE INDEX "agent_thread_messages_thread_idx" ON "agent_thread_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_thread_runs_thread_idx" ON "agent_thread_runs" USING btree ("thread_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_threads_owner_idx" ON "agent_threads" USING btree ("user_id","agent_id","updated_at");