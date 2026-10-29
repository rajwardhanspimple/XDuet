import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createNativeCopilotRouter } from "../src/copilot/native-router";
import type { AgentRunner } from "../src/threads/runner-base";
import { Observable } from "rxjs";
import { EventType } from "@ag-ui/core";
import type { Message } from "@ag-ui/client";

describe("Native CopilotKit Router", () => {
  const mockRunner: AgentRunner = {
    run: (req) => {
      return new Observable((sub) => {
        sub.next({
          type: EventType.RUN_STARTED,
          timestamp: Date.now(),
          threadId: req.threadId,
          runId: "run_1",
          protocolVersion: "1.0",
        });
        sub.next({
          type: EventType.TEXT_MESSAGE_START,
          timestamp: Date.now(),
          messageId: "msg_1",
          role: "assistant",
        });
        sub.next({
          type: EventType.TEXT_MESSAGE_CONTENT,
          timestamp: Date.now(),
          messageId: "msg_1",
          delta: "Hello from native AG-UI!",
        });
        sub.next({
          type: EventType.TEXT_MESSAGE_END,
          timestamp: Date.now(),
          messageId: "msg_1",
        });
        sub.next({
          type: EventType.RUN_FINISHED,
          timestamp: Date.now(),
          threadId: req.threadId,
          runId: "run_1",
          outcome: { type: "success" },
        });
        sub.complete();
      });
    },
    connect: (_req) => {
      return new Observable((sub) => {
        sub.next({
          type: EventType.MESSAGES_SNAPSHOT,
          timestamp: Date.now(),
          messages: [],
        });
        sub.complete();
      });
    },
    stop: async () => true,
    isRunning: async (req) => req.threadId === "busy_thread",
    listThreads: () => [],
    getThreadMessages: () => [
      {
        id: "msg_saved",
        role: "assistant",
        toolCalls: [
          {
            id: "call_1",
            function: {
              name: "query",
              arguments: { table: "users" },
            },
          },
        ],
      } as unknown as Message,
    ],
  };

  // biome-ignore lint/suspicious/noExplicitAny: test mock resolver
  const mockResolver: any = {
    resolveAgentsForActor: async () => ({
      default: {
        agentId: "default",
        description: "Test Assistant",
      },
    }),
    // biome-ignore lint/suspicious/noExplicitAny: test mock resolver
    resolveAgentForActor: async (_actor: any, agentId: string) => {
      if (agentId === "unknown") return null;
      return {
        agentId,
        description: "Test Agent",
      };
    },
  };

  // biome-ignore lint/suspicious/noExplicitAny: test mock actor
  const mockIdentifyActor: any = async () => ({
    id: "user_test",
    role: "user",
    type: "user",
  });

  const app = new Hono();
  const router = createNativeCopilotRouter({
    runner: mockRunner,
    resolver: mockResolver,
    identifyActor: mockIdentifyActor,
    generativeUiEnabled: true,
  });
  app.route("/", router);

  it("GET /api/copilotkit/info returns wire-compatible capability discovery", async () => {
    const res = await app.request("/api/copilotkit/info");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe("1.77.0");
    expect(body.mode).toBe("sse");
    expect(body.threadEndpoints.inspect).toBe(true);
    expect(body.a2uiEnabled).toBe(true);
    expect(body.agents.default).toBeDefined();
  });

  it("POST /api/copilotkit/agent/:id/run streams SSE events", async () => {
    const res = await app.request("/api/copilotkit/agent/default/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "thread_1",
        runId: "run_1",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("RUN_STARTED");
    expect(text).toContain("TEXT_MESSAGE_CONTENT");
    expect(text).toContain("Hello from native AG-UI!");
    expect(text).toContain("RUN_FINISHED");
  });

  it("POST /api/copilotkit/agent/:id/run rejects busy thread with 409", async () => {
    const res = await app.request("/api/copilotkit/agent/default/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "busy_thread",
        runId: "run_busy",
        messages: [],
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("THREAD_LOCKED");
  });

  it("POST /api/copilotkit/agent/:id/connect supports live-run mode check", async () => {
    const res = await app.request("/api/copilotkit/agent/default/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "idle_thread",
        forwardedProps: { openbotAsk: "live-run" },
      }),
    });
    expect(res.status).toBe(204);

    const busyRes = await app.request("/api/copilotkit/agent/default/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "busy_thread",
        forwardedProps: { openbotAsk: "live-run" },
      }),
    });
    expect(busyRes.status).toBe(200);
    const busyBody = await busyRes.json();
    expect(busyBody.runId).toBe("live_busy_thread");
  });

  it("POST /api/copilotkit/agent/:id/stop/:threadId stops execution", async () => {
    const res = await app.request(
      "/api/copilotkit/agent/default/stop/thread_1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: "run_1" }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stopped).toBe(true);
    expect(body.status).toBe("stopped");
  });

  it("GET /api/copilotkit/threads/:id/messages normalizes toolCalls to OpenAI stringified format", async () => {
    const res = await app.request("/api/copilotkit/threads/thread_1/messages");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
    const msg = body.messages[0];
    expect(msg.role).toBe("assistant");
    expect(msg.toolCalls[0].type).toBe("function");
    expect(msg.toolCalls[0].function.name).toBe("query");
    expect(typeof msg.toolCalls[0].function.arguments).toBe("string");
    expect(msg.toolCalls[0].function.arguments).toBe('{"table":"users"}');
  });
});
