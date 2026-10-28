DROP INDEX "agent_thread_messages_thread_idx";--> statement-breakpoint
ALTER TABLE "agent_thread_messages" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_thread_messages_thread_idx" ON "agent_thread_messages" USING btree ("thread_id","position");