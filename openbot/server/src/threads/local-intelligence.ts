import type { Message } from "@ag-ui/client";
import type { IntelligenceLike } from "@openbot/toolkit/run-turn";
import type { PostgresAgentRunner } from "./postgres-runner";

type ThreadHistoryMessage = {
  id: string;
  role: string;
  content?: unknown;
  activityType?: string;
  toolCalls?: { id: string; name: string; args: string }[];
  toolCallId?: string;
};

/**
 * The small part of the Intelligence client a headless turn actually calls, answered from the
 * durable local runner.
 *
 * This is the bridge that keeps routines, group conversations, responsibilities and handoffs
 * working while the platform runs without Intelligence. Unlike the in-memory version it replaced,
 * history and locks are in Postgres: a restart does not forget a routine's conversation, and a
 * second process cannot take a thread this one is running.
 */
export function createLocalIntelligence(
  runner: PostgresAgentRunner,
): IntelligenceLike {
  return {
    getOrCreateThread: async ({ threadId, userId, agentId }) => {
      await runner.ensureThread({ threadId, userId, agentId });
      return {};
    },
    getThreadMessages: async ({ threadId, userId }) => ({
      messages: (await runner.readThreadMessages(threadId, userId)).map(
        toThreadHistoryMessage,
      ),
    }),
    ɵacquireThreadLock: async ({
      threadId,
      runId,
      userId,
      agentId,
      ttlSeconds,
    }) => {
      const acquired = await runner.acquireThreadLock({
        threadId,
        runId,
        userId,
        agentId,
        ...(ttlSeconds ? { ttlMs: ttlSeconds * 1_000 } : {}),
      });
      if (!acquired) throw busy();
      return { threadId, runId };
    },
    ɵrenewThreadLock: async ({ threadId, runId, ttlSeconds }) => {
      const renewed = await runner.renewThreadLock({
        threadId,
        runId,
        ...(ttlSeconds ? { ttlMs: ttlSeconds * 1_000 } : {}),
      });
      if (!renewed) throw busy();
      return { threadId, runId };
    },
    ɵcleanupThreadLock: async ({ threadId, runId }) => {
      await runner.releaseThreadLock({ threadId, runId });
    },
  };
}

function toThreadHistoryMessage(message: Message): ThreadHistoryMessage {
  const toolCalls =
    message.role === "assistant" && "toolCalls" in message
      ? message.toolCalls?.map((call) => ({
          id: call.id,
          name: call.function.name,
          args: call.function.arguments,
        }))
      : undefined;
  return {
    id: message.id,
    role: message.role,
    content: "content" in message ? message.content : undefined,
    ...("activityType" in message && message.activityType
      ? { activityType: message.activityType }
      : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...("toolCallId" in message && message.toolCallId
      ? { toolCallId: message.toolCallId }
      : {}),
  };
}

function busy(): Error {
  return Object.assign(new Error("The thread already has a running turn."), {
    name: "PlatformRequestError",
    status: 409,
  });
}
