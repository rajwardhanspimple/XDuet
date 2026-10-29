import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import {
  agentThreadLocks,
  agentThreadRuns,
  agentThreads,
  approvalRequests,
  users,
  workItems,
} from "../src/db/schema";
import { PostgresAgentRunner } from "../src/threads/postgres-runner";
import { TEST_POOL, testDatabaseUrl } from "./support/database";

const database = createDatabase(testDatabaseUrl(), TEST_POOL);
const userId = "cold-crash-tester";

beforeAll(async () => {
  await database
    .insert(users)
    .values({ id: userId, email: `${userId}@example.test` })
    .onConflictDoNothing();
});

afterAll(async () => {
  await database
    .delete(approvalRequests)
    .where(eq(approvalRequests.ownerUserId, userId));
  await database.delete(agentThreads).where(eq(agentThreads.userId, userId));
  await database.delete(users).where(eq(users.id, userId));
});

describe("Cold crash recovery across server restarts", () => {
  test("pending approvals survive cold crash and remain pending for user decision", async () => {
    const threadId = randomUUID();
    const runId = randomUUID();
    const toolCallId = `tool-${randomUUID()}`;
    const approvalId = `approval-${randomUUID()}`;

    // Seed a pending approval
    await database.insert(approvalRequests).values({
      id: approvalId,
      ownerUserId: userId,
      runId,
      toolCallId,
      actionDigest: "digest-1",
      action: {
        botId: "openduet",
        toolRef: "browser/click",
        parameters: { target: "submit" },
      } as never,
      status: "pending",
    });

    // Simulate cold crash and reboot via runner.hydrate()
    const runner = new PostgresAgentRunner(database);
    await runner.hydrate();

    // Verify approval is still pending and intact
    const [retrieved] = await database
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, approvalId));

    expect(retrieved).toBeDefined();
    expect(retrieved.status).toBe("pending");
    expect(retrieved.actionDigest).toBe("digest-1");
  });

  test("interrupted thread runs are cleanly failed and thread locks cleared", async () => {
    const threadId = randomUUID();
    const runId = randomUUID();
    const runner = new PostgresAgentRunner(database);
    await runner.ensureThread({ threadId, userId, agentId: "test-bot" });

    await database.insert(agentThreadRuns).values({
      id: runId,
      threadId,
      agentId: "test-bot",
      status: "running",
    });

    await runner.acquireThreadLock({
      threadId,
      runId,
      userId,
      agentId: "test-bot",
    });

    // Verify lock exists
    const beforeLocks = await database
      .select()
      .from(agentThreadLocks)
      .where(eq(agentThreadLocks.threadId, threadId));
    expect(beforeLocks.length).toBe(1);

    // Simulate cold crash and reboot
    const rebootedRunner = new PostgresAgentRunner(database);
    await rebootedRunner.hydrate();

    // Verify thread run failed with restart explanation
    const [run] = await database
      .select()
      .from(agentThreadRuns)
      .where(eq(agentThreadRuns.id, runId));
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("restarted");

    // Verify lock was released
    const afterLocks = await database
      .select()
      .from(agentThreadLocks)
      .where(eq(agentThreadLocks.threadId, threadId));
    expect(afterLocks).toEqual([]);
  });

  test("claimed work items from crashed worker are immediately released for resumption", async () => {
    const itemKey = `work-${randomUUID()}`;

    // Seed a work item claimed by a process that died
    await database.insert(workItems).values({
      kind: "approval.resume",
      key: itemKey,
      claimedBy: "dead-pid-99999",
      leaseUntil: new Date(Date.now() + 15 * 60_000), // 15 minutes in future
      payload: { ownerUserId: userId, approvalId: "some-approval" },
    });

    // Cold crash reboot
    const runner = new PostgresAgentRunner(database);
    await runner.hydrate();

    // Work item should be immediately reclaimable
    const [item] = await database
      .select()
      .from(workItems)
      .where(eq(workItems.key, itemKey));
    expect(item?.claimedBy).toBeNull();
    expect(item?.leaseUntil).toBeNull();

    // Cleanup
    await database.delete(workItems).where(eq(workItems.key, itemKey));
  });
});
