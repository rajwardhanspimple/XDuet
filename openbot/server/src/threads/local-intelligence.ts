import type { InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import type { Message } from "@ag-ui/client";
import type { IntelligenceLike } from "@openbot/toolkit/run-turn";

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
 * local in-memory runner.
 *
 * This is the bridge that keeps routines, group conversations, responsibilities and handoffs
 * working while the platform runs without Intelligence. It is honest about its limits: thread
 * history and locks live in this process, so a restart forgets conversations and a second replica
 * cannot see this one's locks. The durable Postgres runner replaces both.
 */
export function createLocalIntelligence(
  runner: InMemoryAgentRunner,
): IntelligenceLike {
  const locks = new Map<string, { runId: string; expiresAt: number }>();
  const ttlMs = 120_000;

  const expired = (threadId: string): boolean => {
    const lock = locks.get(threadId);
    if (lock && lock.expiresAt <= Date.now()) {
      locks.delete(threadId);
      return true;
    }
    return false;
  };

  return {
    getOrCreateThread: async () => ({}),
    getThreadMessages: async ({ threadId }) => ({
      messages: runner.getThreadMessages(threadId).map(toThreadHistoryMessage),
    }),
    ɵacquireThreadLock: async ({ threadId, runId }) => {
      expired(threadId);
      if (locks.has(threadId)) throw busy();
      locks.set(threadId, { runId, expiresAt: Date.now() + ttlMs });
      return { threadId, runId };
    },
    ɵrenewThreadLock: async ({ threadId, runId }) => {
      const lock = locks.get(threadId);
      if (!lock || lock.runId !== runId || lock.expiresAt <= Date.now()) {
        locks.delete(threadId);
        throw busy();
      }
      lock.expiresAt = Date.now() + ttlMs;
      return { threadId, runId };
    },
    ɵcleanupThreadLock: async ({ threadId, runId }) => {
      const lock = locks.get(threadId);
      if (lock?.runId === runId) locks.delete(threadId);
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
