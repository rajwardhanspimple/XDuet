import type { BaseEvent, Message } from "@ag-ui/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AgentActor } from "../agents/profile-types";
import type { ActorAgentResolver } from "../agents/agent-resolver";
import type { AgentRunner } from "../threads/runner-base";

export interface NativeRouterOptions {
  runner: AgentRunner;
  resolver: ActorAgentResolver;
  identifyActor: (req: Request) => Promise<AgentActor>;
  generativeUiEnabled?: boolean;
  basePath?: string;
  readHistory?: (threadId: string, actorId: string) => Promise<Message[]>;
}

/**
 * Normalizes message records from persistence to the OpenAI format required
 * by @copilotkit/react-core/v2's ToolCallRenderer and headless hooks.
 */
export function normalizeMessagesForHydration(
  rawMessages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rawMessages.map((m) => {
    const msg: Record<string, unknown> = {
      id: m.id,
      role: m.role,
    };

    // Omit empty content on assistant messages to prevent markdown renderer crashes
    if (
      m.content !== undefined &&
      m.content !== null &&
      (m.content !== "" || m.role !== "assistant")
    ) {
      msg.content = m.content;
    }

    // Normalize tool calls to OpenAI function calling format
    if (m.toolCalls && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      msg.toolCalls = (m.toolCalls as Array<Record<string, unknown>>).map(
        (tc) => {
          const fn = tc.function as Record<string, unknown> | undefined;
          const fnArgs = fn?.arguments ?? tc.args;
          return {
            id: tc.id,
            type: "function",
            function: {
              name: fn?.name ?? tc.name,
              arguments:
                typeof fnArgs === "string"
                  ? fnArgs
                  : JSON.stringify(fnArgs ?? {}),
            },
          };
        },
      );
    }

    if (m.toolCallId) {
      msg.toolCallId = m.toolCallId;
    }

    // Preserve activityType for role: "activity" messages per @copilotkit/react-core/v2
    if (m.activityType) {
      msg.activityType = m.activityType;
    } else if (m.role === "activity") {
      msg.activityType = m.activityType || m.type || "generative_ui";
    }

    if (m.metadata) {
      msg.metadata = m.metadata;
    }

    if (m.attachments) {
      msg.attachments = m.attachments;
    }

    return msg;
  });
}

export function createNativeCopilotRouter(options: NativeRouterOptions): Hono {
  const router = new Hono().basePath(options.basePath ?? "/api/copilotkit");

  // 1. Info discovery route
  router.get("/info", async (c) => {
    try {
      const actor = await options.identifyActor(c.req.raw);
      const availableAgents =
        await options.resolver.resolveAgentsForActor(actor);
      const agentMap: Record<string, unknown> = {};

      for (const [id, agent] of Object.entries(availableAgents)) {
        const desc =
          typeof agent === "object" && agent !== null && "description" in agent
            ? String((agent as { description?: unknown }).description || "")
            : "";
        agentMap[id] = {
          name: desc || id,
          description: desc,
          className: "AbstractAgent",
          capabilities: {},
        };
      }

      return c.json({
        version: "1.77.0",
        agents: agentMap,
        audioFileTranscriptionEnabled: false,
        mode: "sse",
        threadEndpoints: {
          list: true,
          inspect: true,
          mutations: false,
          realtimeMetadata: false,
        },
        suggestions: true,
        a2uiEnabled: options.generativeUiEnabled ?? true,
        a2ui: { enabled: options.generativeUiEnabled ?? true },
        openGenerativeUIEnabled: options.generativeUiEnabled ?? true,
        telemetryDisabled: true,
      });
    } catch (_err) {
      return c.json({
        version: "1.77.0",
        agents: {
          default: {
            name: "default",
            description: "Default Agent",
            className: "AbstractAgent",
            capabilities: {},
          },
        },
        mode: "sse",
        threadEndpoints: {
          list: true,
          inspect: true,
          mutations: false,
          realtimeMetadata: false,
        },
        telemetryDisabled: true,
      });
    }
  });

  // 2. Run agent execution turn (Streaming SSE)
  router.post("/agent/:agentId/run", async (c) => {
    const agentId = decodeURIComponent(c.req.param("agentId"));
    const rawBody = await c.req.json();
    if (!rawBody.runId) {
      rawBody.runId = crypto.randomUUID();
    }
    if (!rawBody.threadId) {
      rawBody.threadId = crypto.randomUUID();
    }
    const actor = await options.identifyActor(c.req.raw);
    const agent = await options.resolver.resolveAgentForActor(actor, agentId);

    if (!agent) {
      return c.json(
        { error: `Agent '${agentId}' not found or unauthorized` },
        404,
      );
    }

    // Contention Precondition: Check lock BEFORE initiating streamSSE.
    const isBusy = await options.runner.isRunning({
      threadId: rawBody.threadId,
    });
    if (isBusy) {
      return c.json(
        {
          error: "Thread is currently processing an active run",
          code: "THREAD_LOCKED",
          threadId: rawBody.threadId,
        },
        409,
      );
    }

    return streamSSE(c, async (stream) => {
      return new Promise<void>((resolve) => {
        const keepAliveTimer = setInterval(async () => {
          try {
            await stream.write(": keep-alive\n\n");
          } catch {
            clearInterval(keepAliveTimer);
          }
        }, 15_000);

        const event$ = options.runner.run({
          threadId: rawBody.threadId,
          agent,
          input: rawBody,
        });

        const subscription = event$.subscribe({
          next: async (event: BaseEvent) => {
            try {
              await stream.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch {
              subscription.unsubscribe();
              clearInterval(keepAliveTimer);
              resolve();
            }
          },
          error: async (err: unknown) => {
            clearInterval(keepAliveTimer);
            const errorPayload = {
              type: "RUN_ERROR",
              timestamp: Date.now(),
              message: err instanceof Error ? err.message : String(err),
              code: "RUN_EXECUTION_FAILED",
            };
            try {
              await stream.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
            } catch {}
            resolve();
          },
          complete: async () => {
            clearInterval(keepAliveTimer);
            resolve();
          },
        });

        stream.onAbort(() => {
          clearInterval(keepAliveTimer);
          subscription.unsubscribe();
          resolve();
        });
      });
    });
  });

  // 3. Connect agent endpoint (dual-purpose)
  router.post("/agent/:agentId/connect", async (c) => {
    const agentId = decodeURIComponent(c.req.param("agentId"));
    const body = await c.req.json().catch(() => ({}));

    // Mode A: Live run inquiry query
    if (body.forwardedProps?.openbotAsk === "live-run") {
      const isBusy = await options.runner.isRunning({
        threadId: body.threadId,
      });
      if (!isBusy) {
        return c.body(null, 204);
      }
      return c.json({ runId: `live_${body.threadId}` }, 200);
    }

    // Mode B: Stream replay and follow with explicit Promise
    return streamSSE(c, async (stream) => {
      return new Promise<void>((resolve) => {
        const event$ = options.runner.connect({
          threadId: body.threadId,
          agentId,
        });

        const sub = event$.subscribe({
          next: async (event: BaseEvent) => {
            try {
              await stream.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch {
              sub.unsubscribe();
              resolve();
            }
          },
          error: async (err: unknown) => {
            try {
              const msg = err instanceof Error ? err.message : String(err);
              await stream.write(
                `data: ${JSON.stringify({ type: "RUN_ERROR", message: msg })}\n\n`,
              );
            } catch {}
            resolve();
          },
          complete: async () => {
            resolve();
          },
        });

        stream.onAbort(() => {
          sub.unsubscribe();
          resolve();
        });
      });
    });
  });

  // 4. Stop active agent run
  router.post("/agent/:agentId/stop/:threadId", async (c) => {
    const threadId = decodeURIComponent(c.req.param("threadId"));
    const body = await c.req.json().catch(() => ({}));
    await options.runner.stop({ threadId, runId: body.runId });
    return c.json(
      {
        stopped: true,
        status: "stopped",
        interrupt: {
          type: "RUN_ERROR",
          message: "Run stopped by user",
          code: "STOPPED",
        },
      },
      200,
    );
  });

  // 5. Thread message history hydration
  router.get("/threads/:threadId/messages", async (c) => {
    const threadId = decodeURIComponent(c.req.param("threadId"));
    const actor = await options.identifyActor(c.req.raw);
    const rawMessages = options.readHistory
      ? await options.readHistory(threadId, actor.id)
      : options.runner.getThreadMessages(threadId);
    const normalizedMessages = normalizeMessagesForHydration(rawMessages);
    return c.json({ messages: normalizedMessages }, 200);
  });

  return router;
}
