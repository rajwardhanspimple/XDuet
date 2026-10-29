import {
  AbstractAgent,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";

export interface BuiltInAgentConfiguration {
  model?: any;
  prompt?: string;
  tools?: any[];
  maxSteps?: number;
  apiKey?: string;
  type?: string;
  factory?: (ctx?: any) => any;
  [key: string]: any;
}

export class BuiltInAgent extends AbstractAgent {
  constructor(public readonly config: BuiltInAgentConfiguration) {
    super({
      agentId: (config as any)?.agentId ?? "builtin",
      description: (config as any)?.description ?? "Built-in Agent",
    });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: "RUN_STARTED",
        timestamp: Date.now(),
        threadId: input.threadId,
        runId: input.runId,
        protocolVersion: "1.0",
      } as BaseEvent);
      subscriber.next({
        type: "RUN_FINISHED",
        timestamp: Date.now(),
        threadId: input.threadId,
        runId: input.runId,
        outcome: { type: "success" },
      } as BaseEvent);
      subscriber.complete();
    });
  }

  clone(): BuiltInAgent {
    return new BuiltInAgent(this.config);
  }
}
