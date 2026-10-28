import type { ThreadLock } from "@openbot/toolkit/ports";

/**
 * The in-process version of a conversation's run lock.
 *
 * The browser path gets its real lock from the runtime's runner, which refuses a second run on the
 * same thread. This exists for headless turns and handoffs, which used to ask the Intelligence
 * platform. It is deliberately process-local: one local server has one process, and a deployment
 * with more than one replica needs a database-backed lock, not this.
 */
export function createLocalThreadLock(
  options: {
    onRunBusy?: (input: {
      threadId: string;
      runId: string;
      busy: boolean;
    }) => void | Promise<void>;
  } = {},
): ThreadLock {
  const ttlMs = 120_000;
  const held = new Map<string, { runId: string; expiresAt: number }>();

  const clearExpired = (threadId: string): void => {
    const lock = held.get(threadId);
    if (lock && lock.expiresAt <= Date.now()) held.delete(threadId);
  };

  return {
    acquire: async ({ threadId, runId }) => {
      clearExpired(threadId);
      if (held.has(threadId)) return null;
      held.set(threadId, { runId, expiresAt: Date.now() + ttlMs });
      try {
        await options.onRunBusy?.({ threadId, runId, busy: true });
      } catch {}
      return { runId };
    },
    renew: async ({ threadId, runId }) => {
      const lock = held.get(threadId);
      if (lock?.runId === runId) lock.expiresAt = Date.now() + ttlMs;
    },
    release: async ({ threadId, runId }) => {
      const lock = held.get(threadId);
      if (lock?.runId === runId) held.delete(threadId);
      try {
        await options.onRunBusy?.({ threadId, runId, busy: false });
      } catch {}
    },
  };
}
