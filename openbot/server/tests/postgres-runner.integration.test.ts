import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { eq } from "drizzle-orm";
import type { Observable } from "rxjs";
import { createDatabase } from "../src/db/client";
import {
  agentThreadLocks,
  agentThreadRuns,
  agentThreads,
} from "../src/db/schema";
import { PostgresAgentRunner } from "../src/threads/postgres-runner";
import { TEST_POOL, testDatabaseUrl } from "./support/database";

const database = createDatabase(testDatabaseUrl(), TEST_POOL);
const userId = "test-local-user";

function collect(observable: Observable<BaseEvent>): Promise<BaseEvent[]> {
  return new Promise((resolve, reject) => {
    const events: BaseEvent[] = [];
    observable.subscribe({
      next: (event) => events.push(event),
      error: reject,
      complete: () => resolve(events),
    });
  });
}

function inputFor(
  threadId: string,
  runId: string,
  text: string,
): RunAgentInput {
  const user: Message = {
    id: `user-${runId}`,
    role: "user",
    content: text,
  };
  return {
    threadId,
    runId,
    messages: [user],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

function fakeAgent(
  messages: Message[],
  wait?: Promise<void>,
  state?: Record<string, unknown>,
): AbstractAgent {
  const agent = {
    agentId: "test-agent",
    messages: [] as Message[],
    abortRun: () => undefined,
    async runAgent(
      input: ReturnType<typeof inputFor>,
      options: {
        onEvent: (input: { event: BaseEvent }) => void;
        onNewMessage?: (input: { message: Message }) => void;
      },
    ) {
      await wait;
      options.onEvent({
        event: {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
          input,
        } as BaseEvent,
      });
      if (state) {
        options.onEvent({
          event: {
            type: EventType.STATE_SNAPSHOT,
            snapshot: state,
          } as BaseEvent,
        });
      }
      const assistant: Message = {
        id: `assistant-${input.runId}`,
        role: "assistant",
        content: "Hello from the durable runner.",
      };
      agent.messages = [...messages, assistant];
      options.onNewMessage?.({ message: assistant });
      options.onEvent({
        event: {
          type: EventType.TEXT_MESSAGE_START,
          messageId: assistant.id,
          role: "assistant",
        } as BaseEvent,
      });
      options.onEvent({
        event: {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: assistant.id,
          delta: "Hello from the durable runner.",
        } as BaseEvent,
      });
      options.onEvent({
        event: {
          type: EventType.TEXT_MESSAGE_END,
          messageId: assistant.id,
        } as BaseEvent,
      });
      options.onEvent({
        event: {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        } as BaseEvent,
      });
    },
  };
  return agent as unknown as AbstractAgent;
}

function failingAgent(message: string): AbstractAgent {
  const agent = {
    agentId: "test-agent",
    messages: [] as Message[],
    abortRun: () => undefined,
    async runAgent(
      input: ReturnType<typeof inputFor>,
      options: { onEvent: (input: { event: BaseEvent }) => void },
    ) {
      options.onEvent({
        event: {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
          input,
        } as BaseEvent,
      });
      throw new Error(message);
    },
  };
  return agent as unknown as AbstractAgent;
}

function abortableAgent(): {
  agent: AbstractAgent;
  started: Promise<void>;
} {
  let started: (() => void) | undefined;
  let aborted: (() => void) | undefined;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const abortedPromise = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  const agent = {
    agentId: "test-agent",
    messages: [] as Message[],
    abortRun: () => aborted?.(),
    async runAgent(
      input: ReturnType<typeof inputFor>,
      options: { onEvent: (input: { event: BaseEvent }) => void },
    ) {
      options.onEvent({
        event: {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
          input,
        } as BaseEvent,
      });
      started?.();
      await abortedPromise;
    },
  };
  return { agent: agent as unknown as AbstractAgent, started: startedPromise };
}

afterAll(async () => {
  await database.delete(agentThreads).where(eq(agentThreads.userId, userId));
});

describe("PostgresAgentRunner", () => {
  test("persists a run, its messages and its events across a restart", async () => {
    const threadId = randomUUID();
    const runId = randomUUID();
    const runner = new PostgresAgentRunner(database);
    await runner.hydrate();
    await runner.ensureThread({ threadId, userId, agentId: "test-agent" });

    const input = inputFor(threadId, runId, "Is this durable?");
    const events = await collect(
      runner.run({
        threadId,
        agent: fakeAgent(input.messages),
        input,
      }),
    );

    expect(
      events.some(
        (event) =>
          event.type === EventType.TEXT_MESSAGE_CONTENT &&
          event.delta === "Hello from the durable runner.",
      ),
    ).toBe(true);
    expect(
      runner.getThreadMessages(threadId).map((message) => message.id),
    ).toEqual([input.messages[0]?.id, `assistant-${runId}`]);
    expect(await runner.readThreadMessages(threadId, userId)).toHaveLength(2);
    expect(await runner.readThreadMessages(threadId, "somebody-else")).toEqual(
      [],
    );

    /*
     * A second turn must keep the first turn in place. Message ids and timestamps are not a
     * conversation order; the snapshot's array is, and the database has to preserve it across the
     * restart below.
     */
    const secondRunId = randomUUID();
    const secondTurn = inputFor(threadId, secondRunId, "And another turn?");
    secondTurn.messages = [
      ...runner.getThreadMessages(threadId),
      ...secondTurn.messages,
    ];
    await collect(
      runner.run({
        threadId,
        agent: fakeAgent(secondTurn.messages),
        input: secondTurn,
      }),
    );
    const expectedIds = [
      ...secondTurn.messages.map((message) => message.id),
      `assistant-${secondRunId}`,
    ];

    const restarted = new PostgresAgentRunner(database);
    await restarted.hydrate();
    expect(
      restarted.getThreadMessages(threadId).map((message) => message.id),
    ).toEqual(expectedIds);
    expect(
      (await restarted.readThreadMessages(threadId, userId)).map(
        (message) => message.id,
      ),
    ).toEqual(expectedIds);
    expect(
      (await collect(restarted.connect({ threadId }))).some(
        (event) => event.type === EventType.RUN_FINISHED,
      ),
    ).toBe(true);
  });

  test("the database lock is one run per thread and can be re-acquired by its owner", async () => {
    const threadId = randomUUID();
    const runner = new PostgresAgentRunner(database);
    await runner.ensureThread({ threadId, userId, agentId: "test-agent" });

    await expect(
      runner.acquireThreadLock({
        threadId,
        runId: "run-a",
        userId,
        agentId: "test-agent",
      }),
    ).resolves.toBe(true);
    await expect(
      runner.acquireThreadLock({
        threadId,
        runId: "run-b",
        userId,
        agentId: "test-agent",
      }),
    ).resolves.toBe(false);
    await expect(
      runner.acquireThreadLock({
        threadId,
        runId: "run-a",
        userId,
        agentId: "test-agent",
      }),
    ).resolves.toBe(true);

    await runner.releaseThreadLock({ threadId, runId: "run-a" });
    await expect(
      runner.acquireThreadLock({
        threadId,
        runId: "run-b",
        userId,
        agentId: "test-agent",
      }),
    ).resolves.toBe(true);
    await runner.releaseThreadLock({ threadId, runId: "run-b" });
  });

  test("a second run on the same thread is refused while the first is live", async () => {
    const threadId = randomUUID();
    const runner = new PostgresAgentRunner(database);
    await runner.ensureThread({ threadId, userId, agentId: "test-agent" });

    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstRunId = randomUUID();
    const secondRunId = randomUUID();
    const firstInput = inputFor(threadId, firstRunId, "first");
    const first = collect(
      runner.run({
        threadId,
        agent: fakeAgent(firstInput.messages, waiting),
        input: firstInput,
      }),
    );

    expect(() =>
      runner.run({
        threadId,
        agent: fakeAgent([]),
        input: inputFor(threadId, secondRunId, "second"),
      }),
    ).toThrow("Thread already running");

    release?.();
    await first;
  });

  test("a failed run is persisted as failed without erasing the previous snapshot", async () => {
    const threadId = randomUUID();
    const runner = new PostgresAgentRunner(database);
    await runner.ensureThread({ threadId, userId, agentId: "test-agent" });

    const successfulRunId = randomUUID();
    const firstInput = inputFor(threadId, successfulRunId, "first");
    await collect(
      runner.run({
        threadId,
        agent: fakeAgent(firstInput.messages, undefined, { step: 1 }),
        input: firstInput,
      }),
    );
    expect(runner.getThreadMessages(threadId)).toHaveLength(2);
    expect(runner.getThreadState(threadId)).toEqual({ step: 1 });

    const failingRunId = randomUUID();
    const failedInput = inputFor(threadId, failingRunId, "second");
    await collect(
      runner.run({
        threadId,
        agent: failingAgent("the model fell over"),
        input: failedInput,
      }),
    );

    const [run] = await database
      .select()
      .from(agentThreadRuns)
      .where(eq(agentThreadRuns.id, failingRunId));
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("the model fell over");
    expect(runner.getThreadMessages(threadId)).toHaveLength(2);
    expect(runner.getThreadState(threadId)).toEqual({ step: 1 });
  });

  test("hydrate closes an orphaned run and clears its lock", async () => {
    const threadId = randomUUID();
    const runId = randomUUID();
    const runner = new PostgresAgentRunner(database);
    await runner.ensureThread({ threadId, userId, agentId: "test-agent" });
    await database.insert(agentThreadRuns).values({
      id: runId,
      threadId,
      agentId: "test-agent",
      status: "running",
    });
    await runner.acquireThreadLock({
      threadId,
      runId,
      userId,
      agentId: "test-agent",
    });

    const restarted = new PostgresAgentRunner(database);
    await restarted.hydrate();

    const [run] = await database
      .select()
      .from(agentThreadRuns)
      .where(eq(agentThreadRuns.id, runId));
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("restarted");
    const locks = await database
      .select()
      .from(agentThreadLocks)
      .where(eq(agentThreadLocks.threadId, threadId));
    expect(locks).toEqual([]);
  });

  test("stop ends a mid-run turn and releases its lock", async () => {
    const threadId = randomUUID();
    const runId = randomUUID();
    const runner = new PostgresAgentRunner(database);
    await runner.ensureThread({ threadId, userId, agentId: "test-agent" });

    const { agent, started } = abortableAgent();
    const events = collect(
      runner.run({
        threadId,
        agent,
        input: inputFor(threadId, runId, "please stop"),
      }),
    );
    await started;
    await expect(runner.stop({ threadId, runId })).resolves.toBe(true);
    await events;

    const [run] = await database
      .select()
      .from(agentThreadRuns)
      .where(eq(agentThreadRuns.id, runId));
    expect(run?.status).toBe("stopped");
    const locks = await database
      .select()
      .from(agentThreadLocks)
      .where(eq(agentThreadLocks.threadId, threadId));
    expect(locks).toEqual([]);
  });
});
