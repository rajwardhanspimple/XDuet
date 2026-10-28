import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/**
 * The local replacement for CopilotKit Intelligence's durable threads.
 *
 * One row per conversation, owned by the person who opened it. `state_json` is the AG-UI state
 * snapshot at the end of the last run; `name` is the channel/thread title when a surface has one.
 *
 * A thread id is a name, not an authorization. Every read that answers a person must join this row
 * to the actor asking; see `PostgresAgentRunner.readThreadMessages`.
 */
export const agentThreads = pgTable(
  "agent_threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    agentId: text("agent_id").notNull(),
    name: text("name"),
    archived: boolean("archived").notNull().default(false),
    stateJson: text("state_json"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("agent_threads_owner_idx").on(
      table.userId,
      table.agentId,
      table.updatedAt,
    ),
  ],
);

/**
 * One turn. `status` is the terminal fact a reconnect reads: running, finished, failed or stopped.
 *
 * `input_json` is kept for replay/debugging, not for model context. The model context is the message
 * table below, which is the same snapshot `getThreadMessages` returns.
 */
export const agentThreadRuns = pgTable(
  "agent_thread_runs",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => agentThreads.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    parentRunId: text("parent_run_id"),
    status: text("status").notNull(),
    inputJson: text("input_json"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_thread_runs_thread_idx").on(table.threadId, table.startedAt),
  ],
);

/** Every AG-UI event, append-only. `seq` is per run, so replay is one ordered scan. */
export const agentThreadEvents = pgTable(
  "agent_thread_events",
  {
    runId: text("run_id")
      .notNull()
      .references(() => agentThreadRuns.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => agentThreads.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventJson: text("event_json").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.seq] }),
    index("agent_thread_events_thread_idx").on(table.threadId, table.runId),
  ],
);

/**
 * The message snapshot at the end of a run, as AG-UI messages.
 *
 * Stored whole rather than decomposed: the shape is the runtime's, and a second schema would be one
 * more thing to keep in step with it. `id`, `role` and `position` are columns so a read can order and
 * filter without parsing every message. `position` is the message's index in the snapshot: message
 * ids are opaque and timestamps can tie, so neither is a reliable conversation order.
 */
export const agentThreadMessages = pgTable(
  "agent_thread_messages",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => agentThreads.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    runId: text("run_id"),
    position: integer("position").notNull().default(0),
    role: text("role").notNull(),
    messageJson: text("message_json").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.id] }),
    index("agent_thread_messages_thread_idx").on(
      table.threadId,
      table.position,
    ),
  ],
);

/**
 * One live run per thread. The row is the cross-process lock; `expires_at` is the recovery story.
 *
 * A run that dies without releasing its row stops blocking once the lease expires. The server also
 * clears every lock on boot in local mode, because a local install has exactly one API process and
 * no run can survive its restart.
 */
export const agentThreadLocks = pgTable("agent_thread_locks", {
  threadId: text("thread_id")
    .primaryKey()
    .references(() => agentThreads.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  owner: text("owner").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
