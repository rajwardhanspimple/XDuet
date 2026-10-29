import type { BaseEvent } from "@ag-ui/client";

export interface FinalizeRunOptions {
  stopRequested?: boolean;
  protocolVersion?: string;
  interruptionMessage?: string;
}

interface ToolCallEventLike {
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string;
}

/**
 * Scans an event buffer upon turn conclusion/interruption and synthesizes closing
 * tool call events for any pending or hanging tool invocations.
 */
export function finalizeRunEvents(
  events: BaseEvent[],
  options?: FinalizeRunOptions | "cancelled" | "error" | "timeout",
): BaseEvent[] {
  const appended: BaseEvent[] = [];
  const openToolCalls = new Map<
    string,
    { name?: string; messageId?: string }
  >();

  for (const event of events) {
    const ev = event as unknown as ToolCallEventLike;
    if (event.type === "TOOL_CALL_START" && ev.toolCallId) {
      openToolCalls.set(ev.toolCallId, {
        name: ev.toolCallName,
        messageId: ev.parentMessageId,
      });
    } else if (
      (event.type === "TOOL_CALL_END" || event.type === "TOOL_CALL_RESULT") &&
      ev.toolCallId
    ) {
      openToolCalls.delete(ev.toolCallId);
    }
  }

  // Synthesize closing events for hanging tool calls
  const now = Date.now();
  const reason =
    typeof options === "string"
      ? options
      : options?.stopRequested
        ? "cancelled"
        : "stopped";

  for (const [toolCallId] of openToolCalls) {
    appended.push({
      type: "TOOL_CALL_END",
      timestamp: now,
      toolCallId,
    } as BaseEvent);

    appended.push({
      type: "TOOL_CALL_RESULT",
      timestamp: now,
      messageId: `msg_${toolCallId}_result`,
      toolCallId,
      role: "tool",
      content: `[Tool execution halted: run was ${reason}]`,
    } as BaseEvent);
  }

  return appended;
}
