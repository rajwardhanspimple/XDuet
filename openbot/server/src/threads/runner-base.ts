import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import type { Observable } from "rxjs";

export interface AgentRunnerRunRequest {
  threadId: string;
  agent: AbstractAgent;
  input: RunAgentInput;
}

export interface AgentRunnerConnectRequest {
  threadId: string;
  agentId?: string;
}

export interface AgentRunnerStopRequest {
  threadId: string;
  runId?: string;
}

export interface AgentRunnerIsRunningRequest {
  threadId: string;
  runId?: string;
}

export interface LocalThreadEndpointRecord {
  id: string;
  name: string | null;
  agentId: string;
  organizationId: string;
  createdById: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export abstract class AgentRunner {
  abstract run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  abstract connect(request: AgentRunnerConnectRequest): Observable<BaseEvent>;
  abstract stop(request: AgentRunnerStopRequest): Promise<boolean | undefined>;
  abstract isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean>;
  abstract listThreads(): LocalThreadEndpointRecord[];
  getThread?(threadId: string): LocalThreadEndpointRecord | null;
  abstract getThreadMessages(threadId: string): Message[];
}
