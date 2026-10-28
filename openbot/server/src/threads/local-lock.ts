import type { ThreadLock } from "@openbot/toolkit/ports";
import type { PostgresAgentRunner } from "./postgres-runner";

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

/**
 * The same lock, held in Postgres instead of a Map.
 *
 * Headless turns, handoffs and routines all pass through this. The browser path is covered twice:
 * the runtime's runner acquires the same row before it starts an agent, and this lock is what the
 * handoff machinery uses when it calls a Bot without a browser attached. Both use the run id the
 * caller already chose, so the second acquisition is a refresh rather than a conflict.
 *
 * A conflict returns null, which is the port's "somebody else is running here" answer. Every other
 * database failure is raised: a lock we cannot read is not the same thing as a lock somebody holds.
 */
export function createDurableThreadLock(
  runner: PostgresAgentRunner,
  options: {
    onRunBusy?: (input: {
      threadId: string;
      runId: string;
      busy: boolean;
    }) => void | Promise<void>;
  } = {},
): ThreadLock {
  const announce = async (
    threadId: string,
    runId: string,
    busy: boolean,
  ): Promise<void> => {
    try {
      await options.onRunBusy?.({ threadId, runId, busy });
    } catch {
      // The announcement is observability; losing it must not lose the lock.
    }
  };

  return {
    acquire: async ({ threadId, runId, userId, agentId }) => {
      const acquired = await runner.acquireThreadLock({
        threadId,
        runId,
        userId,
        agentId,
      });
      if (!acquired) return null;
      await announce(threadId, runId, true);
      return { runId };
    },
    renew: async ({ threadId, runId }) => {
      const renewed = await runner.renewThreadLock({ threadId, runId });
      if (!renewed) {
        throw new Error("The thread lock was lost before the run finished.");
      }
    },
    release: async ({ threadId, runId }) => {
      await announce(threadId, runId, false);
      await runner.releaseThreadLock({ threadId, runId });
    },
  };
}
