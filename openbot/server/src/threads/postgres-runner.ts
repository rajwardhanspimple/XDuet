import type { AbstractAgent, BaseEvent, Message } from "@ag-ui/client";
import { compactEvents, EventType } from "@ag-ui/client";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
  type LocalThreadEndpointRecord,
} from "./runner-base";
import { finalizeRunEvents } from "./event-finalizer";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { type Observable, ReplaySubject } from "rxjs";
import type { Database } from "../db/client";
import {
  agentThreadEvents,
  agentThreadLocks,
  agentThreadMessages,
  agentThreadRuns,
  agentThreads,
  workItems,
} from "../db/schema";

/**
 * A durable, single-node AgentRunner backed by Postgres.
 *
 * WHAT IT REPLACES. `InMemoryAgentRunner` keeps every thread, event and message in a process-global
 * Map. That is enough for a demo and wrong for a product: a restart forgets every conversation, and
 * a second process cannot see the first one's locks or history. This runner writes the same things
 * to Postgres and reads them back.
 *
 * WHY IT STILL KEEPS A CACHE. `LocalThreadEndpointRunner` — the interface CopilotKit's own
 * `/threads` routes call — is synchronous. A Postgres query cannot answer it. The cache is the read
 * model those routes see; Postgres is the source of truth. The cache is hydrated once at boot and
 * updated after every run. In local mode there is one API process, so the cache cannot go stale
 * behind another writer. A future multi-replica implementation replaces this with custom async
 * routes and `LISTEN/NOTIFY`; that is deliberately not pretended to work here.
 *
 * THE LOCK IS THE CROSS-PROCESS PART. It is a row with an expiry, not a Map: a server that dies
 * mid-run leaves a lease that expires, and the next run can take the thread. In local mode boot
 * clears every lock and closes every `running` run, because no run can survive a restart of the
 * only API process.
 *
 * EVENT AND MESSAGE ORDER. Events are appended per run with a monotonic `seq`. Messages are the
 * agent's full snapshot at the end of a run, replaced in one transaction. A run that failed before
 * producing a message keeps the previous snapshot rather than erasing the conversation.
 */

const LOCK_TTL_MS = 120_000;
const LOCK_HEARTBEAT_MS = 20_000;
const DEFAULT_OWNER = "dev-local-user";
const RUNNING = "running";
const FINISHED = "finished";
const FAILED = "failed";
const STOPPED = "stopped";

type CachedThread = {
  record: LocalThreadEndpointRecord;
  messages: Message[];
  events: BaseEvent[];
  state: Record<string, unknown> | null;
  runIds: string[];
};

type LiveRun = {
  threadId: string;
  runId: string;
  agent: AbstractAgent;
  subject: ReplaySubject<BaseEvent>;
  currentEvents: BaseEvent[];
  seq: number;
  stopRequested: boolean;
  finalizeControl: { stopRequested: boolean };
  writes: Promise<void>;
  writeError: string | undefined;
  heartbeat: ReturnType<typeof setInterval> | undefined;
  accepted: boolean;
};

export type ThreadHistory = {
  messages: Message[];
};

export class PostgresAgentRunner extends AgentRunner {
  private readonly cache = new Map<string, CachedThread>();
  private readonly live = new Map<string, LiveRun>();
  private readonly owner = `local-${process.pid}-${crypto.randomUUID()}`;

  constructor(private readonly database: Database) {
    super();
    /**
     * The runtime's own thread routes are synchronous and read this cache. Claiming the interface is
     * what keeps `/info` reporting thread endpoints and `/threads/:id/messages` answering the app.
     * The methods below keep the same contract while the writes go to Postgres.
     */
    Object.defineProperty(this, "ɵsupportsLocalThreadEndpoints", {
      value: true,
      enumerable: true,
    });
  }

  /**
   * Load every thread into the read cache and close runs a previous process left open.
   *
   * Awaited once at boot, before the HTTP handler is mounted. In local mode this is a single-user
   * dataset; a deployment with thousands of threads should replace the cache with async routes
   * rather than preloading them all.
   */
  async hydrate(): Promise<void> {
    await this.database
      .update(agentThreadRuns)
      .set({
        status: FAILED,
        error: "The server restarted while this run was in progress.",
        finishedAt: new Date(),
      })
      .where(eq(agentThreadRuns.status, RUNNING));
    await this.database.delete(agentThreadLocks);
    await this.database
      .update(workItems)
      .set({
        claimedBy: null,
        leaseUntil: null,
      })
      .where(
        and(
          sql`${workItems.claimedBy} is not null`,
          sql`${workItems.finishedAt} is null`,
        ),
      );

    const threads = await this.database
      .select()
      .from(agentThreads)
      .orderBy(asc(agentThreads.createdAt));
    for (const thread of threads) {
      await this.loadThread(thread.id);
    }
  }

  /** The runtime's synchronous thread list, served from the cache. */
  listThreads(): LocalThreadEndpointRecord[] {
    return [...this.cache.values()]
      .map((thread) => thread.record)
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      );
  }

  /** The runtime's synchronous message snapshot, served from the cache. */
  getThreadMessages(threadId: string): Message[] {
    return [...(this.cache.get(threadId)?.messages ?? [])];
  }

  /** The runtime's synchronous event view, compacted the same way `connect` replays it. */
  getThreadEvents(threadId: string): BaseEvent[] {
    return compactEvents(this.cache.get(threadId)?.events ?? []);
  }

  /** The runtime's synchronous state snapshot, from the last STATE_SNAPSHOT event. */
  getThreadState(threadId: string): Record<string, unknown> | null {
    return this.cache.get(threadId)?.state ?? null;
  }

  /** The runtime's local-dev clear. It deletes the conversations, because that is what it promises. */
  clearThreads(): void {
    for (const live of this.live.values()) {
      if (live.heartbeat) clearInterval(live.heartbeat);
      try {
        live.agent.abortRun();
      } catch {
        // The row is about to be deleted; an agent that cannot abort does not change that.
      }
    }
    this.live.clear();
    this.cache.clear();
    void this.database.delete(agentThreads).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          type: "local-thread-clear-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }

  /**
   * A person's thread history, read from Postgres and checked against the actor.
   *
   * This is the method the app's history route and headless turns use. `getThreadMessages` above is
   * the runtime's cache-only view; this one is the durable, ownership-checked answer.
   */
  async readThreadMessages(
    threadId: string,
    userId: string,
  ): Promise<Message[]> {
    const owned = await this.threadExists(threadId, userId);
    if (!owned) return [];
    const cached = this.cache.get(threadId);
    if (cached) return [...cached.messages];

    const rows = await this.database
      .select({ messageJson: agentThreadMessages.messageJson })
      .from(agentThreadMessages)
      .where(eq(agentThreadMessages.threadId, threadId))
      .orderBy(
        asc(agentThreadMessages.position),
        asc(agentThreadMessages.createdAt),
        asc(agentThreadMessages.id),
      );
    return rows.map((row) => parseMessage(row.messageJson));
  }

  /** Whether this person owns this thread. A thread id is never authorization on its own. */
  async threadExists(threadId: string, userId: string): Promise<boolean> {
    const [row] = await this.database
      .select({ id: agentThreads.id })
      .from(agentThreads)
      .where(
        and(eq(agentThreads.id, threadId), eq(agentThreads.userId, userId)),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Create the thread row if the caller has not yet. Idempotent, and never changes an owner. */
  async ensureThread(input: {
    threadId: string;
    userId: string;
    agentId: string;
  }): Promise<void> {
    await this.database
      .insert(agentThreads)
      .values({
        id: input.threadId,
        userId: input.userId,
        agentId: input.agentId,
      })
      .onConflictDoNothing();
  }

  /** Acquire the per-thread lease used by headless turns and the runner itself. */
  async acquireThreadLock(input: {
    threadId: string;
    runId: string;
    userId: string;
    agentId: string;
    ttlMs?: number;
  }): Promise<boolean> {
    await this.ensureThread(input);
    const ttl = input.ttlMs ?? LOCK_TTL_MS;
    const rows = await this.database.execute(sql`
      INSERT INTO agent_thread_locks
        (thread_id, run_id, owner, expires_at, heartbeat_at)
      VALUES (
        ${input.threadId}, ${input.runId}, ${this.owner},
        now() + (${ttl} * interval '1 millisecond'), now()
      )
      ON CONFLICT (thread_id) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        owner = EXCLUDED.owner,
        expires_at = EXCLUDED.expires_at,
        heartbeat_at = now()
      WHERE agent_thread_locks.expires_at <= now()
         OR agent_thread_locks.run_id = EXCLUDED.run_id
      RETURNING thread_id
    `);
    return rows.length > 0;
  }

  /** Keep a lease alive. Returns false when the lease is no longer ours. */
  async renewThreadLock(input: {
    threadId: string;
    runId: string;
    ttlMs?: number;
  }): Promise<boolean> {
    const ttl = input.ttlMs ?? LOCK_TTL_MS;
    const rows = await this.database.execute(sql`
      UPDATE agent_thread_locks
      SET expires_at = now() + (${ttl} * interval '1 millisecond'),
          heartbeat_at = now()
      WHERE thread_id = ${input.threadId}
        AND run_id = ${input.runId}
        AND expires_at > now()
      RETURNING thread_id
    `);
    return rows.length > 0;
  }

  /** Give a lease back. Safe when it was already released or taken over. */
  async releaseThreadLock(input: {
    threadId: string;
    runId: string;
  }): Promise<void> {
    await this.database
      .delete(agentThreadLocks)
      .where(
        and(
          eq(agentThreadLocks.threadId, input.threadId),
          eq(agentThreadLocks.runId, input.runId),
        ),
      );
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    if (this.live.has(request.threadId)) {
      throw new Error("Thread already running");
    }
    const live: LiveRun = {
      threadId: request.threadId,
      runId: request.input.runId,
      agent: request.agent,
      subject: new ReplaySubject<BaseEvent>(Infinity),
      currentEvents: [],
      seq: 0,
      stopRequested: false,
      finalizeControl: { stopRequested: false },
      writes: Promise.resolve(),
      writeError: undefined,
      heartbeat: undefined,
      accepted: false,
    };
    this.live.set(request.threadId, live);
    void this.execute(request, live);
    return live.subject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const connection = new ReplaySubject<BaseEvent>(Infinity);
    const cached = this.cache.get(request.threadId);
    const emittedMessageIds = new Set<string>();

    for (const event of compactEvents(cached?.events ?? [])) {
      connection.next(event);
      if ("messageId" in event && typeof event.messageId === "string") {
        emittedMessageIds.add(event.messageId);
      }
    }

    const live = this.live.get(request.threadId);
    if (live) {
      live.subject.subscribe({
        next: (event) => {
          if (
            "messageId" in event &&
            typeof event.messageId === "string" &&
            emittedMessageIds.has(event.messageId)
          ) {
            return;
          }
          connection.next(event);
        },
        complete: () => connection.complete(),
        error: (error) => connection.error(error),
      });
    } else {
      connection.complete();
    }
    return connection.asObservable();
  }

  async isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    if (this.live.has(request.threadId)) return true;
    const [lock] = await this.database
      .select({ threadId: agentThreadLocks.threadId })
      .from(agentThreadLocks)
      .where(
        and(
          eq(agentThreadLocks.threadId, request.threadId),
          sql`${agentThreadLocks.expiresAt} > now()`,
        ),
      )
      .limit(1);
    return lock !== undefined;
  }

  async stop(request: AgentRunnerStopRequest): Promise<boolean> {
    const live = this.live.get(request.threadId);
    if (!live) return false;
    if (request.runId !== undefined && live.runId !== request.runId)
      return false;
    if (live.stopRequested) return false;
    live.stopRequested = true;
    live.finalizeControl.stopRequested = true;
    try {
      live.agent.abortRun();
      return true;
    } catch {
      live.stopRequested = false;
      live.finalizeControl.stopRequested = false;
      return false;
    }
  }

  private async execute(
    request: AgentRunnerRunRequest,
    live: LiveRun,
  ): Promise<void> {
    try {
      await this.ensureThread({
        threadId: request.threadId,
        userId: DEFAULT_OWNER,
        agentId: request.agent.agentId ?? "default",
      });
      const acquired = await this.acquireThreadLock({
        threadId: request.threadId,
        runId: live.runId,
        userId: DEFAULT_OWNER,
        agentId: request.agent.agentId ?? "default",
      });
      if (!acquired) throw new Error("Thread already running");

      const previous = this.cache.get(request.threadId);
      const parentRunId = previous?.runIds.at(-1) ?? null;
      await this.database.insert(agentThreadRuns).values({
        id: live.runId,
        threadId: request.threadId,
        agentId: request.agent.agentId ?? "default",
        parentRunId,
        status: RUNNING,
        inputJson: safeStringify(request.input),
      });
      live.accepted = true;
      live.heartbeat = setInterval(() => {
        void this.renewThreadLock({
          threadId: live.threadId,
          runId: live.runId,
        })
          .then((renewed) => {
            if (renewed) return;
            /*
             * Losing the lease means another process may now be allowed to run this thread. Do not
             * keep writing events and a message snapshot under a lock we no longer hold: stop the
             * agent, mark the run failed, and let the lease holder own the thread.
             */
            live.writeError =
              "The thread lock expired while the run was in progress.";
            try {
              live.agent.abortRun();
            } catch {
              // The run is already failed; an agent that cannot abort does not change that.
            }
            console.error(
              JSON.stringify({
                type: "local-thread-lock-lost",
                threadId: live.threadId,
                runId: live.runId,
              }),
            );
          })
          .catch((error: unknown) => {
            console.error(
              JSON.stringify({
                type: "local-thread-heartbeat-failed",
                threadId: live.threadId,
                runId: live.runId,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          });
      }, LOCK_HEARTBEAT_MS);

      const historicIds = new Set(
        previous?.messages.map((message) => message.id),
      );
      const onEvent = ({ event }: { event: BaseEvent }) => {
        let processed = event;
        if (event.type === EventType.RUN_STARTED && !event.input) {
          processed = {
            ...event,
            input: {
              ...request.input,
              messages: request.input.messages.filter(
                (message) => !historicIds.has(message.id),
              ),
            },
          };
        }
        this.record(live, processed);
      };

      await request.agent.runAgent(request.input, {
        onEvent,
        onNewMessage: () => undefined,
        onRunStartedEvent: () => undefined,
      });
      await this.finalize(request, live, {});
    } catch (error) {
      if (!live.accepted) {
        this.live.delete(request.threadId);
        await this.releaseThreadLock({
          threadId: live.threadId,
          runId: live.runId,
        }).catch(() => undefined);
        live.subject.error(error);
        return;
      }
      await this.finalize(request, live, {
        interruptionMessage:
          error instanceof Error ? error.message : String(error),
      }).catch((finalizeError: unknown) => {
        if (live.heartbeat) clearInterval(live.heartbeat);
        this.live.delete(request.threadId);
        live.subject.error(finalizeError);
      });
    }
  }

  private record(live: LiveRun, event: BaseEvent): void {
    live.currentEvents.push(event);
    live.subject.next(event);
    const seq = live.seq++;
    live.writes = live.writes
      .then(async () => {
        await this.database
          .insert(agentThreadEvents)
          .values({
            runId: live.runId,
            threadId: live.threadId,
            seq,
            eventJson: safeStringify(event),
          })
          .onConflictDoNothing();
      })
      .catch((error: unknown) => {
        live.writeError =
          error instanceof Error ? error.message : String(error);
        console.error(
          JSON.stringify({
            type: "local-thread-event-write-failed",
            threadId: live.threadId,
            runId: live.runId,
            error: live.writeError,
          }),
        );
      });
  }

  private async finalize(
    request: AgentRunnerRunRequest,
    live: LiveRun,
    outcome: { interruptionMessage?: string },
  ): Promise<void> {
    if (
      live.stopRequested &&
      !live.currentEvents.some((event) => event.type === EventType.RUN_STARTED)
    ) {
      const started: BaseEvent = {
        type: EventType.RUN_STARTED,
        threadId: request.threadId,
        runId: request.input.runId,
        input: {
          ...request.input,
          messages: request.input.messages.filter(
            (message) =>
              !this.cache
                .get(request.threadId)
                ?.messages.some((known) => known.id === message.id),
          ),
        },
      } as BaseEvent;
      this.record(live, started);
    }

    const appended = [
      ...finalizeRunEvents(live.currentEvents, {
        stopRequested: live.finalizeControl.stopRequested,
        protocolVersion: request.input.protocolVersion,
        ...(outcome.interruptionMessage !== undefined
          ? { interruptionMessage: outcome.interruptionMessage }
          : {}),
      }),
    ];
    for (const event of appended) this.record(live, event);

    await live.writes;
    if (live.heartbeat) clearInterval(live.heartbeat);

    const status = live.stopRequested
      ? STOPPED
      : outcome.interruptionMessage !== undefined || live.writeError
        ? FAILED
        : FINISHED;
    const error = live.writeError ?? outcome.interruptionMessage ?? null;
    const messages = Array.isArray(request.agent.messages)
      ? [...request.agent.messages]
      : [];
    const cache = this.cache.get(request.threadId);
    /*
     * A run that never emitted a state snapshot has not said "the state is now empty". Keep the
     * last snapshot the thread had, exactly as an empty message snapshot keeps the previous
     * conversation rather than erasing it.
     */
    const state = stateOf(live.currentEvents) ?? cache?.state ?? null;
    const threadRecord = cache?.record ?? this.recordOf(request, messages);

    await this.database.transaction(async (transaction) => {
      await transaction
        .update(agentThreadRuns)
        .set({
          status,
          error,
          finishedAt: new Date(),
        })
        .where(eq(agentThreadRuns.id, live.runId));

      if (messages.length > 0) {
        await transaction
          .delete(agentThreadMessages)
          .where(eq(agentThreadMessages.threadId, request.threadId));
        const snapshotAt = new Date();
        await transaction.insert(agentThreadMessages).values(
          messages.map((message, position) => ({
            threadId: request.threadId,
            id: message.id,
            runId: live.runId,
            position,
            role: message.role,
            messageJson: safeStringify(message),
            createdAt: snapshotAt,
          })),
        );
      }

      await transaction
        .update(agentThreads)
        .set({
          stateJson: state ? safeStringify(state) : null,
          updatedAt: new Date(),
        })
        .where(eq(agentThreads.id, request.threadId));

      await transaction
        .delete(agentThreadLocks)
        .where(
          and(
            eq(agentThreadLocks.threadId, request.threadId),
            eq(agentThreadLocks.runId, live.runId),
          ),
        );
    });

    this.cache.set(request.threadId, {
      record: {
        ...threadRecord,
        updatedAt: new Date().toISOString(),
      },
      messages: messages.length > 0 ? messages : (cache?.messages ?? []),
      events: [...(cache?.events ?? []), ...live.currentEvents],
      state,
      runIds: [...(cache?.runIds ?? []), live.runId],
    });

    this.live.delete(request.threadId);
    live.subject.complete();
  }

  private recordOf(
    request: AgentRunnerRunRequest,
    _messages: Message[],
  ): LocalThreadEndpointRecord {
    const now = new Date().toISOString();
    return {
      id: request.threadId,
      name: null,
      agentId: request.agent.agentId ?? "default",
      organizationId: "",
      createdById: DEFAULT_OWNER,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async loadThread(threadId: string): Promise<void> {
    const [thread] = await this.database
      .select()
      .from(agentThreads)
      .where(eq(agentThreads.id, threadId))
      .limit(1);
    if (!thread) return;

    const runs = await this.database
      .select()
      .from(agentThreadRuns)
      .where(eq(agentThreadRuns.threadId, threadId))
      .orderBy(asc(agentThreadRuns.startedAt));
    const runIds = runs.map((run) => run.id);

    const messageRows = await this.database
      .select({ messageJson: agentThreadMessages.messageJson })
      .from(agentThreadMessages)
      .where(eq(agentThreadMessages.threadId, threadId))
      .orderBy(
        asc(agentThreadMessages.position),
        asc(agentThreadMessages.createdAt),
        asc(agentThreadMessages.id),
      );

    const eventRows =
      runIds.length > 0
        ? await this.database
            .select({
              runId: agentThreadEvents.runId,
              seq: agentThreadEvents.seq,
              eventJson: agentThreadEvents.eventJson,
            })
            .from(agentThreadEvents)
            .where(inArray(agentThreadEvents.runId, runIds))
        : [];
    const order = new Map(runIds.map((id, index) => [id, index]));
    eventRows.sort((left, right) => {
      const runDifference =
        (order.get(left.runId) ?? 0) - (order.get(right.runId) ?? 0);
      return runDifference !== 0 ? runDifference : left.seq - right.seq;
    });

    this.cache.set(threadId, {
      record: {
        id: thread.id,
        name: thread.name,
        agentId: thread.agentId,
        organizationId: "",
        createdById: thread.userId,
        archived: thread.archived,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      },
      messages: messageRows.map((row) => parseMessage(row.messageJson)),
      events: eventRows.map((row) => parseEvent(row.eventJson)),
      state: thread.stateJson ? parseObject(thread.stateJson) : null,
      runIds,
    });
  }
}

function stateOf(events: readonly BaseEvent[]): Record<string, unknown> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === EventType.STATE_SNAPSHOT) {
      return event.snapshot && typeof event.snapshot === "object"
        ? { ...(event.snapshot as Record<string, unknown>) }
        : null;
    }
  }
  return null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function parseMessage(value: string): Message {
  try {
    return JSON.parse(value) as Message;
  } catch {
    throw new Error("A stored thread message was not valid JSON.");
  }
}

function parseEvent(value: string): BaseEvent {
  try {
    return JSON.parse(value) as BaseEvent;
  } catch {
    throw new Error("A stored thread event was not valid JSON.");
  }
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
