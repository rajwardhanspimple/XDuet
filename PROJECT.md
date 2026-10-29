# OpenDuet Master Architecture & Implementation Plan: Non-UI CopilotKit Decoupling & Native AG-UI Migration

**Author**: OpenDuet Architectural Team  
**Status**: Authoritative Reference Blueprint (Iteration 2 Revision)  
**Target Specification File**: `d:\openduet\PROJECT.md`  
**Scope**: Repository-wide (`openbot/server`, `openbot/toolkit`, `openbot/desktop`, `openbot/charts`, `openbot/scripts`, CI/CD)  
**Strict Invariant**: Zero code modifications to `openbot/app` (frozen UI client)

---

## 1. Executive Summary & Architectural Vision

### 1.1 Vision and Core Architectural Principle
OpenDuet is transitioning from a hybrid runtime reliant on external CopilotKit cloud services to a 100% sovereign, local-first, native AG-UI (`@ag-ui/*`) and custom Hono streaming architecture. 

Historically, OpenDuet utilized `@copilotkit/runtime` to serve conversational agents to the browser. However, comprehensive architectural investigation has established that **CopilotKit Runtime v2 is fundamentally an adapter layer over the AG-UI protocol**. The microservices within OpenDuet (`agent-bot`, `agent-langgraph`, `agent-langgraph-agui`) already communicate natively using the AG-UI HTTP/SSE protocol (`POST /ag-ui`). 

By replacing `@copilotkit/runtime` and `@copilotkit/aimock` with a high-performance native Hono streaming router in `openbot/server` and native `AbstractAgent` implementations in `openbot/toolkit`, OpenDuet achieves:
1. **Zero External SaaS Lock-in**: Complete removal of dependencies on CopilotKit Cloud Intelligence (`api.intelligence.copilotkit.ai`), license token verification gateways, and telemetry endpoints (`telemetry.copilotkit.ai`).
2. **Absolute Privacy & Enterprise Data Governance**: Conversation turns, tool invocations, prompts, and file attachments remain strictly within local or customer-managed infrastructure (PostgreSQL).
3. **High-Fidelity Wire Compatibility**: Strict emulation of the `/api/copilotkit` wire protocol (all 5 endpoints and 23 SSE streaming events), ensuring **zero lines of code change in `openbot/app`**.
4. **Resilient Local Persistence**: Elevation of `PostgresAgentRunner` and the local PostgreSQL database schema (`agent_threads`, `agent_thread_runs`, `agent_thread_events`, `agent_thread_messages`, `agent_thread_locks`) to the primary production persistence and distributed locking tier.
5. **Clean Monorepo Topological Layering**: Complete preservation of architectural boundaries, where foundational packages like `@openbot/toolkit` maintain zero upward dependencies on server applications or database schemas.

### 1.2 Requirements Traceability Matrix (R1–R5)

| Requirement | Objective | Primary Target Locations | Core Technical Solution |
| :--- | :--- | :--- | :--- |
| **R1: Architecture & Decoupling Plan** | Replace `@copilotkit/runtime`, `@copilotkit/aimock`, and non-UI adapters with native AG-UI and custom Hono streaming. | `openbot/server/package.json`, `openbot/server/src/copilot/*`, `openbot/server/src/threads/*`, `openbot/toolkit/package.json` | Native Hono sub-app router (`native-router.ts`), `streamSSE` pipeline with explicit Promise lifecycle, in-repo test mock suite (`tests/mocks/*`), and native `AgentRunner` base class. |
| **R2: Protocol & Contract Fidelity** | Detail exact `/api/copilotkit` protocol contract, schemas, and 23 SSE events, guaranteeing zero React UI changes. | `openbot/server/src/routes/copilotkit.ts`, `openbot/app/src/lib/copilot/*` | Implement `/info`, `/agent/:id/run`, `/connect`, `/stop/:threadId`, `/threads/:id/messages`; conform strictly to `@ag-ui/core` schemas (including `RunFinishedInterruptOutcomeSchema` with mandatory `reason: string` and `min(1)` interrupts array, mandatory `messageId: string` on `TOOL_CALL_RESULT`, and OpenAI tool call normalization with activityType preservation). |
| **R3: Cloud Intelligence & Telemetry Decoupling** | Remove cloud intelligence (`api.intelligence.copilotkit.ai`) and telemetry (`X-CopilotKit-Telemetry-Id`) from Desktop and Server. | `openbot/desktop/src-tauri/src/*`, `openbot/desktop/src/*`, `openbot/server/src/telemetry.ts`, `openbot/server/src/config.ts` | Telemetry disabled/suppressed in `telemetry.rs` and `desktop_telemetry.rs`; desktop `main.rs` permits local keys; Tauri IPC intelligence commands stubbed; setup wizard renders `<SetupProgress>` in `<ProviderPicker>`, advances model -> ask and triggers `start(choice)`. |
| **R4: Toolkit & Deployment Migration** | Migrate `BuiltInAgentWithSaneHistory`, distributed thread locking, Dockerfiles, Helm charts, and environment templates. | `openbot/toolkit/src/*`, `openbot/charts/openbot/*`, `.env.example`, `openbot/scripts/start.sh`, `.github/workflows/ci.yml` | `NativeBuiltInAgent extends AbstractAgent` using Vercel AI SDK `fullStream`; `LockableThreadRunner` port; retain `@deprecated` shims for rollback; purge `validation.yaml` refusals, CI refusal checks, and `INTELLIGENCE_*` variables. |
| **R5: Phased Roadmap & Verification** | Incremental 4-phase rollout, risk mitigation, rollback contingencies, and objective verification test suites. | All packages, CI/CD (`.github/workflows/ci.yml`) | Multi-phase roadmap, realistic package re-installation rollback steps, Helm safe rollback flags with `--values` files, contract validation scripts, and `bun test` suites. |

---

## 2. Current vs. Target Architecture Matrix & Non-UI Inventory

### 2.1 Complete Cross-Subsystem Component Inventory

The following table catalogs every non-UI CopilotKit dependency, file, and configuration across the OpenDuet repository and specifies its target replacement:

| Subsystem | File / Component Path | Current CopilotKit Usage | Target Native AG-UI Replacement |
| :--- | :--- | :--- | :--- |
| **Server** | `openbot/server/package.json` | `@copilotkit/runtime: 1.77.0`, `@copilotkit/aimock: 1.43.0` | **Removed**. Replaced by native Hono routes, `@ag-ui/client: 1.0.1`, `@ag-ui/core: 1.0.1`, and in-repo mocks. |
| **Server** | `openbot/server/src/threads/postgres-runner.ts` | Extends `AgentRunner`, imports request types, `finalizeRunEvents`, and `LocalThreadEndpointRecord` from `@copilotkit/runtime/v2` | Extends native `AgentRunner` base class defined in `src/threads/runner-base.ts`; imports in-repo `finalizeRunEvents` from `src/threads/event-finalizer.ts`. |
| **Server** | `openbot/server/src/openduet/reply-turn.ts` | Imports `resolveModel` from `@copilotkit/runtime/v2` (lines 3 & 469) | Replaced with native model provider resolver using Vercel AI SDK or OpenBot model provider registry (`src/models/provider.ts`). |
| **Server** | `openbot/server/src/agents/plan-model.ts` | Imports `BuiltInAgentClassicConfig` from `@copilotkit/runtime/v2` for `PlanLanguageModel` (lines 4 & 13) | Defined using native model specification types conforming to Vercel AI SDK `LanguageModelV1`. |
| **Server** | `openbot/server/src/learning/runtime.ts` | Imports `formatSkillCatalog, loadSkill, readSkillFile, SkillRegistry` from `@copilotkit/runtime/internal/learned-skills` and `CopilotKitIntelligence` | Implements lightweight in-repo Markdown/YAML skill parser in `src/learning/runtime.ts`; replaces `CopilotKitIntelligence` with local PostgreSQL skills repository. |
| **Server** | `openbot/server/src/learning/auto-assign.ts` | Imports `CopilotKitIntelligence` from `@copilotkit/runtime/v2` | Routes skill auto-assignment directly to local PostgreSQL skill assignments. |
| **Server** | `openbot/server/src/learning/routes.ts` | Imports `type CopilotKitIntelligence` from `@copilotkit/runtime/v2` | Routes skill API management to local database endpoints. |
| **Server** | `openbot/server/src/memory/intelligence.ts` | Imports `type CopilotKitIntelligence` from `@copilotkit/runtime/v2` for memory operations | Replaced by local memory store (`src/memory/local-memory.ts`) using PostgreSQL vector / key-value storage. |
| **Server** | `openbot/server/src/self-host-banner.ts` | Imports `type CopilotKitIntelligence` from `@copilotkit/runtime/v2` for entitlement checks | Replaced with native self-hosted licensing and community banner logic without external cloud entitlement queries. |
| **Server** | `openbot/server/src/intelligence-client.ts` | Imports `CopilotKitIntelligence` from `@copilotkit/runtime/v2` and wraps error logging | Replaced with a local sovereign client stub or disabled when running in native local mode. |
| **Server** | `openbot/server/src/agents/handoff-wiring.ts` | Imports `IntelligenceAgentRunner` from `@copilotkit/runtime/v2` | Wired directly to `PostgresAgentRunner` or native `AgentRunner`. |
| **Server** | `openbot/server/src/config.ts` | Checks `OPENBOT_LOCAL_MODE` and throws fatal error at line 1033 if `INTELLIGENCE_*` variables are missing | Refactored: defaults `localModeEnabled(environment)` to `true` and evaluates `localMode: localModeEnabled(environment) \|\| runtimeCapabilities(environment).mode === "local"`, removes mandatory `INTELLIGENCE_*` check, preventing cloud entitlement queries in `setup.ts`. |
| **Server** | `openbot/server/src/index.ts` | Imports from `@copilotkit/runtime/v2`, gates `localRunner` on `OPENBOT_LOCAL_MODE` | Instantiates `createNativeCopilotRouter` with `PostgresAgentRunner` as the default runtime engine. |
| **Server** | `openbot/server/src/copilot.ts` | `mountCopilotRuntime()`, `mountLocalCopilotRuntime()`, `CopilotSseRuntime`, `createCopilotHonoHandler` | Native Hono router mounted via `createNativeCopilotRouter()` directly invoking `PostgresAgentRunner`. |
| **Server** | `openbot/server/src/app.ts` | `copilotHandler?: HonoApp` mounted at root `app.route("/", copilotHandler)` | Mounts native router at root with internal `.basePath("/api/copilotkit")`. |
| **Server** | `openbot/server/src/admin/gate.ts` | Access gating for `/api/copilotkit/agent/:id/*` and `/x/agent/:id/*` | Retained intact. Intercepts native router routes to enforce bot profile authorizations. |
| **Server** | `openbot/server/src/telemetry.ts` | Sets `COPILOTKIT_TELEMETRY_SAMPLE_RATE`, exports `runtimeTelemetryProperties` | Replaced by native OpenTelemetry logger or no-op telemetry shim. |
| **Server** | `openbot/server/src/desktop-telemetry.ts` | Propagates machine ID and tags to `CopilotRuntime` telemetry | Converted to local audit log or disabled. |
| **Server** | `openbot/server/tests/*` (11 suites) | Imports `LLMock`, `MCPMock`, `AGUIMock` from `@copilotkit/aimock` | Replaced with `openbot/server/tests/mocks/{llmock,mcpmock,aguimock}.ts` using native Bun/Hono test servers. |
| **Server** | `openbot/server/tests/telemetry.test.ts` & `tests/fixtures/telemetry-probe.ts` | Imports from `@copilotkit/runtime/v2` for telemetry verification | Refactored to test native OpenTelemetry / audit logging fixtures. |
| **Toolkit** | `openbot/toolkit/package.json` | `@copilotkit/runtime: 1.77.0` | **Removed**. Adds `ai: ^3.4.0` and `@ai-sdk/openai: ^0.0.60`. Retains `@ag-ui/client: 1.0.1`, `@openbot/shared`, `rxjs`, `zod`. |
| **Toolkit** | `openbot/toolkit/src/copilotkit/agents.ts` | `BuiltInAgentWithSaneHistory extends BuiltInAgent` | Refactored: `BuiltInAgentWithSaneHistory extends NativeBuiltInAgent` (where `NativeBuiltInAgent extends AbstractAgent`). |
| **Toolkit** | `openbot/toolkit/src/copilotkit/thread-lock.ts` | `createIntelligenceThreadLock` invoking `ɵacquireThreadLock`, `ɵrenewThreadLock` | **Replaced**. Replaced by port `LockableThreadRunner` in `src/ports.ts`. Retained as `@deprecated` shim during Phase 1 for clean Phase 2 rollback. |
| **Toolkit** | `openbot/toolkit/src/copilotkit/agents.ts` | `IntelligenceKnowingANewThread extends CopilotKitIntelligence` | **Replaced**. Replaced by native database lookups returning empty message array. Retained as `@deprecated` shim during Phase 1 for clean Phase 2 rollback. |
| **Toolkit** | `openbot/toolkit/tests/thread-lock.test.ts` | Tests `createIntelligenceThreadLock` | Updated to test `ThreadLock` port against an in-memory lock runner mock and verify backward compatibility of shim. |
| **Desktop** | `openbot/desktop/src-tauri/src/telemetry.rs` & `desktop_telemetry.rs` | Dispatches POST to `https://telemetry.copilotkit.ai/ingest`, attaches `X-CopilotKit-Telemetry-Id` | Default endpoint set to `None`; hardcoded URL in `desktop_telemetry.rs:23` removed; header suppressed; telemetry queue becomes no-op. |
| **Desktop** | `openbot/desktop/src-tauri/src/main.rs` | `intelligence_key_for_start` (lines 1007–1024, 1414) enforces non-empty key | In local sovereign mode, returns `"local-sovereign-key"` instead of `Connection::Intelligence` problem, enabling stack start without cloud key. |
| **Desktop** | `openbot/desktop/src-tauri/src/intelligence.rs` | OAuth loopback listener, CLI token exchange with `api.operations.copilotkit.ai`, project provisioning on `api.intelligence.copilotkit.ai` | Tauri IPC commands return native local stubs; loopback listener disabled in local mode. |
| **Desktop** | `openbot/desktop/src/App.tsx` | Setup wizard steps: `welcome` -> `harness` -> `install` -> `model` -> `connect` -> `ask` | In local/native mode, `<ProviderPicker>` renders `<SetupProgress>` during container initialization, `onChoose` triggers `void start(choice)`, and line 580 routes returning launches (`savedLaunch.current === installationKey`) to `"ask"`. |
| **Desktop** | `openbot/desktop/src-tauri/src/env.rs` | Writes environment variables for Docker Compose | Adds `OPENBOT_LOCAL_MODE=true` to compose environment; removes mandatory `INTELLIGENCE_*` variables. |
| **Root** | `openbot/package.json` & `scripts/mock-knowledge-mcp.ts` | DevDependency `"@copilotkit/aimock": "1.43.0"` and import in MCP script | Purged from root `package.json`; script updated to use native MCP mock. |
| **Deployment** | `.env.example` | Declares `INTELLIGENCE_*`, `CPK_*`, `COPILOTKIT_*` variables | **Purged**. All external cloud keys and telemetry toggles removed. |
| **Deployment** | `openbot/charts/openbot/templates/validation.yaml` | Fails install if `config.intelligence.apiUrl` or `secrets.intelligenceApiKey` missing; checks learning service token | **Purged**. Refusal check at line 81 and learning service token validation at lines 392–399 deleted. |
| **Deployment** | `openbot/charts/openbot/templates/learning/setup-job.yaml` | Kubernetes Job creating cloud learning containers via CLI | **Deleted**. |
| **Deployment** | `openbot/scripts/start.sh` | Probes `/api/copilotkit/info` for `licenseStatus === "valid"`, runs `setup-learning.ts` | **Removed**. Health check probes standard HTTP 200 `{ status: "ok" }`. |
| **CI/CD** | `.github/workflows/ci.yml` | Tests image with dummy intelligence env (598–606), checks setup job (211–223), asserts refusal of learning service token (286–287) | Injected dummy env removed; setup job test removed; refusal assertion at lines 286–287 deleted. |

### 2.2 Architectural Evolution: Target A vs. Target B

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Architectural Evolution                         │
├──────────────────────────┬──────────────────────┬──────────────────────┤
│ Legacy Baseline          │ Target A (Interim)   │ Target B (Master     │
│                          │                      │ Architecture)        │
├──────────────────────────┼──────────────────────┼──────────────────────┤
│ - CopilotKit Cloud       │ - OPENBOT_LOCAL_MODE │ - Native Hono Router │
│   Intelligence Platform  │ - PostgresAgentRunner│   (/api/copilotkit)  │
│ - External Thread Locks  │ - CopilotSseRuntime  │ - Pure @ag-ui/* Core │
│ - Remote Realtime Gateway│ - Kept @copilotkit/  │ - Zero @copilotkit/  │
│ - External PostHog Ingest│   runtime & aimock   │   runtime or aimock  │
│ - Mandatory Cloud Key    │ - Telemetry active   │ - Zero Cloud Calls   │
│ - Closed Sovereign Airgap│ - Partial Airgap     │ - 100% Sovereign     │
└──────────────────────────┴──────────────────────┴──────────────────────┘
```

---

## 3. Exact Protocol Contract & Wire Fidelity (`/api/copilotkit`)

To guarantee zero code changes in `openbot/app`, the native Hono router must provide absolute wire-level parity for the 5 HTTP routes, all request/response schemas, and all 23 Server-Sent Events.

### 3.1 Network Mounting & Security Invariants
1. **Mounting Path Invariant**: The native router is mounted at root `app.route("/", copilotRouter)` where `copilotRouter` defines `new Hono().basePath("/api/copilotkit")`. Mounting at `app.route("/api/copilotkit", copilotRouter)` causes route doubling (`/api/copilotkit/api/copilotkit/info`) and client 404 failures.
2. **Session Authentication Guard**: All `/api/copilotkit/*` endpoints sit behind the Better Auth session guard (`identifyActor`), reading session cookies (`better-auth.session_token`).
3. **Enterprise Access Gate**: Requests to `/api/copilotkit/agent/:id/*` are passed through `src/admin/gate.ts` to ensure actor authorization for the requested bot profile.

---

### 3.2 Deep Endpoint Specifications

#### Endpoint 1: Runtime Capability Discovery
- **Route**: `GET /api/copilotkit/info`
- **Headers**: `Accept: application/json`, Cookie: Better Auth session token.
- **Response**: `200 OK`, `Content-Type: application/json`
- **Payload Schema**:
```json
{
  "version": "1.77.0",
  "agents": {
    "default": {
      "name": "default",
      "description": "Primary assistant",
      "className": "AbstractAgent",
      "capabilities": {}
    }
  },
  "audioFileTranscriptionEnabled": false,
  "mode": "sse",
  "threadEndpoints": {
    "list": true,
    "inspect": true,
    "mutations": false,
    "realtimeMetadata": false
  },
  "suggestions": true,
  "a2uiEnabled": true,
  "a2ui": {
    "enabled": true
  },
  "openGenerativeUIEnabled": true,
  "telemetryDisabled": true
}
```
*Critical Contract Rule*: `mode` must be `"sse"`. `threadEndpoints.inspect` must be `true` (otherwise frontend disables message history fetching).

---

#### Endpoint 2: Agent Turn Execution (Streaming SSE)
- **Route**: `POST /api/copilotkit/agent/:agentId/run`
- **Headers**:
  - `Content-Type: application/json`
  - `Accept: text/event-stream`
  - `credentials: include`
- **Request Body (`RunAgentInput` Schema from `@ag-ui/core`)**:
```typescript
interface RunAgentInput {
  threadId: string;
  runId: string;
  protocolVersion?: string;
  parentRunId?: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "activity";
    content?: string;
    toolCalls?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string; // Must be JSON-stringified
      };
    }>;
    toolCallId?: string; // For role: "tool"
    attachments?: Array<{
      id: string;
      name: string;
      type: string;
      url: string;
    }>;
  }>;
  tools: Array<{
    name: string;
    description?: string;
    parameters: Record<string, unknown>; // JSON Schema
  }>;
  context: Array<{
    id?: string;
    value: string;
    description?: string;
  }>;
  state: Record<string, unknown>;
  forwardedProps?: {
    openbotAsk?: string;
    a2uiAction?: unknown;
    voiceContext?: unknown;
    [key: string]: unknown;
  };
  resume?: Array<{
    interruptId: string;
    action: "resolve" | "reject";
    payload?: unknown;
  }>;
}
```
- **Contention / Lock Refusal Precondition**:
  Before opening the SSE stream (calling `streamSSE`), the server must check if the requested `threadId` is actively locked by an in-flight run. If locked, the server **immediately returns `409 Conflict`** with JSON `{ error: "Thread is currently running another turn", code: "THREAD_LOCKED" }`. It must NOT commit `200 OK` streaming headers before contention checking.
- **Response**: `200 OK`, `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- **Response Body**: Chunks formatted as `data: <JSON>\n\n` with keepalive comments `: keep-alive\n\n` emitted every 15 seconds. The callback inside `streamSSE` must return an explicit `Promise<void>` that only resolves upon Observable termination/error or client abort.

---

#### Endpoint 3: Realtime Thread Reconnect & Status Check
- **Route**: `POST /api/copilotkit/agent/:agentId/connect`
- **Headers**: `Content-Type: application/json`, `credentials: include`
- **Dual Behavior Based on Body**:
  1. **Mode A (Live Run Polling)**:
     - When `forwardedProps.openbotAsk === "live-run"`:
     - If thread is **idle**: Return **`204 No Content`** (or `200 OK` with `{"runId": null}`).
     - If thread is **busy**: Return **`200 OK`** with `{"runId": "<active-run-id>"}`.
  2. **Mode B (Realtime Event Replay & Join)**:
     - Standard connect payload.
     - Return **`text/event-stream`** replaying compacted events (`agent_thread_events`) followed by live event streaming for active runs, returning an explicit completion Promise to prevent early stream closure.

---

#### Endpoint 4: Run Cancellation / Stop
- **Route**: `POST /api/copilotkit/agent/:agentId/stop/:threadId`
- **Headers**: `Content-Type: application/json`, `credentials: include`
- **Request Body**: `{ "runId": "<optional-run-id>" }`
- **Canonical Response Schema**:
```json
{
  "stopped": true,
  "status": "stopped",
  "interrupt": {
    "type": "RUN_ERROR",
    "message": "Run stopped by user",
    "code": "STOPPED"
  }
}
```
*Critical Requirement*: The response must include `"stopped": true` to satisfy `@copilotkit/runtime` client handle-stop contract.
- **Backend Requirement**: Invokes `runner.stop({ threadId, runId })`, aborts execution signal, releases database lock in `agent_thread_locks`, and emits `RUN_FINISHED` with outcome `cancelled`.

---

#### Endpoint 5: Thread History Hydration
- **Route**: `GET /api/copilotkit/threads/:threadId/messages?agentId=:agentId`
- **Headers**: `credentials: include`
- **Response**: `200 OK`, `Content-Type: application/json`
- **Payload Schema**:
```json
{
  "messages": [
    {
      "id": "msg-001",
      "role": "user",
      "content": "Generate the quarterly financial ledger."
    },
    {
      "id": "msg-002",
      "role": "assistant",
      "toolCalls": [
        {
          "id": "call-101",
          "type": "function",
          "function": {
            "name": "sql_query",
            "arguments": "{\"query\":\"SELECT * FROM ledger LIMIT 10;\"}"
          }
        }
      ]
    },
    {
      "id": "msg-003",
      "role": "tool",
      "toolCallId": "call-101",
      "content": "{\"rows\": 10, \"status\": \"success\"}"
    },
    {
      "id": "msg-004",
      "role": "activity",
      "activityType": "a2ui_card",
      "content": {
        "component": "LedgerCard",
        "props": { "rows": 10, "status": "success" }
      }
    }
  ]
}
```
*Critical Normalization Invariants (Zero Client Crash Guarantee)*:
1. **OpenAI Function Calling Format**: Stored tool calls must be normalized to `{ id: string, type: "function", function: { name: string, arguments: string } }`.
2. **Stringified JSON Arguments**: `function.arguments` must always be a JSON string. If stored as an object, it must be `JSON.stringify`'d.
3. **Omission of Empty Content**: If an assistant message only executed tool calls and emitted no markdown text, `content` must be omitted or `undefined` (never `""` or `null`).
4. **Protection for React's `ToolCallRenderer`**: In `@copilotkit/react-core/v2/headless.cjs`, `ToolCallRenderer` unconditionally dereferences `toolCall.function.name` and `toolCall.function.arguments`. Without this normalization, hydrated messages cause fatal `TypeError: Cannot read properties of undefined (reading 'arguments')`.
5. **Activity Message Type Preservation**: In `@copilotkit/react-core/v2` (`ActivityMessageSchema`), `activityType: z.string()` is mandatory on all messages where `role === "activity"`. The normalizer must preserve `m.activityType` (and `m.metadata`) so A2UI and Generative UI cards (`<OpenGenerativeUIActivityRenderer>`) rehydrate correctly on conversation reload without throwing Zod validation errors.

---

### 3.3 Comprehensive Catalog of All 23 SSE Streaming Events

Every SSE message is transmitted as `data: ${JSON.stringify(event)}\n\n`. When the stream is idle, a heartbeat comment `: keep-alive\n\n` is sent every 15 seconds.

| # | Event Type | Exact JSON Payload Structure | Trigger Condition | Frontend Client Action (`openbot/app`) |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `RUN_STARTED` | `{"type":"RUN_STARTED","timestamp":number,"threadId":string,"runId":string,"protocolVersion":"1.0"}` | Start of turn execution. | Sets `agent.isRunning = true`, locks message composer, resets turn error state. |
| 2 | `RUN_FINISHED` | `{"type":"RUN_FINISHED","timestamp":number,"threadId":string,"runId":string,"outcome":{"type":"success"\|"cancelled"}\|{"type":"interrupt","interrupts":Array<{"id":string,"reason":string}>}}` | Turn concludes normally, cancels, or pauses for approval. Strictly conforms to `@ag-ui/core` schema (`reason: string` is mandatory, `interrupts` requires at least 1 item). | Sets `agent.isRunning = false`, unlocks composer. If `interrupt`, mounts HITL decision UI using `outcome.interrupts`. |
| 3 | `RUN_ERROR` | `{"type":"RUN_ERROR","timestamp":number,"message":string,"code"?:string}` | Uncaught agent error or model rate limit. | Displays sayable error banner in chat header; retains composer draft words. |
| 4 | `TEXT_MESSAGE_START` | `{"type":"TEXT_MESSAGE_START","timestamp":number,"messageId":string,"role":"assistant"}` | Assistant begins emitting markdown text. | Allocates assistant message bubble container in transcript. |
| 5 | `TEXT_MESSAGE_CONTENT`| `{"type":"TEXT_MESSAGE_CONTENT","timestamp":number,"messageId":string,"delta":string}` | Chunk of markdown text from model. | Streams markdown tokens into active message bubble via `Streamdown`. |
| 6 | `TEXT_MESSAGE_END` | `{"type":"TEXT_MESSAGE_END","timestamp":number,"messageId":string}` | Assistant message text completes. | Finalizes markdown AST parsing and finishes cursor animation. |
| 7 | `TOOL_CALL_START` | `{"type":"TOOL_CALL_START","timestamp":number,"toolCallId":string,"toolCallName":string,"parentMessageId"?:string}` | Model begins invoking a tool. | Renders inline tool card pill or mounts custom tool component. |
| 8 | `TOOL_CALL_ARGS` | `{"type":"TOOL_CALL_ARGS","timestamp":number,"toolCallId":string,"delta":string}` | Streamed JSON argument chunk. | Streams argument text into inspectable drawer / preview widget. |
| 9 | `TOOL_CALL_END` | `{"type":"TOOL_CALL_END","timestamp":number,"toolCallId":string}` | Model finishes emitting tool arguments. | Parses JSON arguments; dispatches client execution if tool is frontend-registered. |
| 10 | `TOOL_CALL_RESULT` | `{"type":"TOOL_CALL_RESULT","timestamp":number,"messageId":string,"toolCallId":string,"role":"tool","content":string}` | Server tool completes execution. Mandatory `messageId: string`. | Marks tool card complete; renders output payload in transcript. |
| 11 | `STATE_SNAPSHOT` | `{"type":"STATE_SNAPSHOT","timestamp":number,"snapshot":Record<string,any>}` | Agent replaces state completely. | Overwrites client agent state dictionary (`agent.state`). |
| 12 | `STATE_DELTA` | `{"type":"STATE_DELTA","timestamp":number,"delta":Array<JsonPatchOperation>}` | Incremental agent state mutation. | Applies RFC 6902 JSON patch operations to reactive client state. |
| 13 | `MESSAGES_SNAPSHOT` | `{"type":"MESSAGES_SNAPSHOT","timestamp":number,"messages":Array<Message>}` | Stream reconnect / replay initiation. | Atomically populates transcript messages for active conversation. |
| 14 | `ACTIVITY_SNAPSHOT` | `{"type":"ACTIVITY_SNAPSHOT","timestamp":number,"messageId":string,"activityType":string,"content":Record<string,any>,"replace"?:boolean}` | A2UI or Generative UI card emitted. | Mounts `<OpenGenerativeUIActivityRenderer>` or renders A2UI surface. |
| 15 | `ACTIVITY_DELTA` | `{"type":"ACTIVITY_DELTA","timestamp":number,"messageId":string,"activityType":string,"patch":Array<JsonPatchOperation>}` | Incremental A2UI component mutation. | Updates props and reactive state of mounted generative UI card. |
| 16 | `REASONING_START` | `{"type":"REASONING_START","timestamp":number,"messageId":string}` | Model begins internal chain-of-thought. | Opens collapsible "Thinking..." disclosure drawer. |
| 17 | `REASONING_MESSAGE_START` | `{"type":"REASONING_MESSAGE_START","timestamp":number,"messageId":string,"role":"reasoning"}` | Mounts reasoning bubble. | Prepares streaming container for thoughts. |
| 18 | `REASONING_MESSAGE_CONTENT` | `{"type":"REASONING_MESSAGE_CONTENT","timestamp":number,"messageId":string,"delta":string}` | Thinking token chunk. | Streams thoughts into italicized reasoning view. |
| 19 | `REASONING_MESSAGE_END` | `{"type":"REASONING_MESSAGE_END","timestamp":number,"messageId":string}` | Thinking stream concludes. | Closes thinking message container. |
| 20 | `REASONING_END` | `{"type":"REASONING_END","timestamp":number,"messageId":string}` | Entire reasoning phase complete. | Collapses or marks reasoning drawer complete. |
| 21 | `STEP_STARTED` | `{"type":"STEP_STARTED","timestamp":number,"stepName":string}` | Multi-step agent workflow step starts. | Advances step counter pill in channel status header. |
| 22 | `STEP_FINISHED` | `{"type":"STEP_FINISHED","timestamp":number,"stepName":string}` | Multi-step agent workflow step finishes. | Marks step checkmark green in workflow progress widget. |
| 23 | `CUSTOM` | `{"type":"CUSTOM","timestamp":number,"name":string,"value":any}` | Custom extension event (e.g., `openbot.headless.waiting`). | Handles custom headless approvals or custom telemetry hooks. |

*Schema Invariant*: In `@ag-ui/core/schemas`, `RunFinishedInterruptOutcomeSchema` strictly mandates:
```typescript
z.object({
  type: z.literal("interrupt"),
  interrupts: z.array(z.object({
    id: z.string(),
    reason: z.string(), // Mandatory string in @ag-ui/core (e.g. "tool_approval", "human_in_the_loop")
  })).min(1) // Mandatory at least 1 item
})
```
Emitting `outcome: { type: "interrupt" }` without `interrupts: [...]`, with an empty array `[]`, or without `reason: string` causes `@ag-ui/client`'s `enforceEvents()` pipeline to throw a fatal Zod validation error. When an interrupt occurs, every pending tool call must be mapped into `outcome.interrupts` with a non-empty `reason`.

---

### 3.4 Tool Calling & State Synchronization Handshake

```
                  ┌────────────────────────────────────────────────────────┐
                  │          Client / Server Tool Invocation Flow          │
                  └────────────────────────────────────────────────────────┘
                    Frontend (openbot/app)              Native Hono Server
                              │                                 │
                              │  POST /agent/:id/run            │
                              ├────────────────────────────────>│ (Checks lock; if busy,
                              │                                 │  returns 409 Conflict.
                              │                                 │  Otherwise acquires lock)
                              │  RUN_STARTED                    │
                              │<────────────────────────────────┤
                              │  TOOL_CALL_START (call_01)      │
                              │<────────────────────────────────┤
                              │  TOOL_CALL_ARGS ("{...}")       │
                              │<────────────────────────────────┤
                              │  TOOL_CALL_END                  │
                              │<────────────────────────────────┤
                              │                                 │
        ┌─────────────────────┴──────────────────────┐          │
        ▼ Is tool in server registry?                ▼          │
      [ YES: Server Tool ]                 [ NO: Client Tool ]  │
        │                                            │          │
        │ (Server executes tool)                     │          │
        │ TOOL_CALL_RESULT                           │          │
        │<───────────────────────────────────────────┼──────────┤
        │                                            │ RUN_FINISHED (outcome: interrupt,
        │                                            │  interrupts: [{ id: "call_01",
        │                                            │   reason: "client_execution" }])
        │                                            │<─────────┤ (Stream closes cleanly)
        │                                            │          │
        │                                            │ (Executes React tool handler)
        │                                            │          │
        │                                            │ POST /agent/:id/run
        │                                            │ (Role: "tool", content: result,
        │                                            │  toolCallId: "call_01")
        │                                            ├─────────>│
```

#### RFC 6902 State Patching Mechanics
State deltas emitted over `STATE_DELTA` must adhere strictly to RFC 6902:
```json
[
  { "op": "add", "path": "/selectedEntity", "value": "cust_4892" },
  { "op": "replace", "path": "/verificationStatus", "value": "verified" },
  { "op": "remove", "path": "/temporaryToken" }
]
```

### 3.5 Proof of Zero UI Code Modifications
The following table maps every CopilotKit component and hook utilized in `openbot/app` to its exact wire contract, confirming complete non-UI decoupling feasibility without frontend edits:

| Frontend Component / Hook | Source Path in `openbot/app` | Wire Dependency | Native Backend Guarantee |
| :--- | :--- | :--- | :--- |
| `<CopilotKitProvider>` | `src/lib/copilot/provider.tsx:59` | `GET /api/copilotkit/info` | Responds with exact JSON capabilities, `mode: "sse"`, `threadEndpoints.inspect: true`. |
| `<CopilotChat>` | `src/routes/_authed/_app/bot.tsx:250` | `POST /agent/:id/run`, `GET /threads/:id/messages` | Streams standard text messages; hydrates normalized message lists with OpenAI function tool calls. |
| `useCopilotKit()` | `src/components/channels/channel-chat.tsx:409` | `copilotkit.runAgent`, `stopAgent`, `connectAgent` | Wire handlers for `/run`, `/stop`, `/connect` conform to exact `@ag-ui/core` signatures and return `{ stopped: true }`. |
| `useFrontendTool()` | `src/lib/copilot/approval-tools.tsx:35` | `TOOL_CALL_START` -> `ARGS` -> `END` -> `RUN_FINISHED` | Emits `outcome.interrupts` allowing frontend callback resolution without server-side tool definitions. |
| `useHumanInTheLoop()` | `src/lib/copilot/bot-tools.tsx:97` | `RUN_FINISHED` with `outcome: { type: "interrupt", interrupts: [...] }` | Emits valid interrupt outcome matching `RunFinishedInterruptOutcomeSchema`, maintaining suspension until resume turn is posted. |
| `useRenderTool()` | `src/lib/copilot/morning-brief-tool.tsx:144`| `TOOL_CALL_RESULT` | Server executes tool and streams result event matching registered tool name. |
| `useStoppedTurn()` | `src/lib/copilot/stopped-turn.ts:48` | `RUN_ERROR` event or `RUN_FINISHED` outcome `cancelled` | Native server emits clean error codes without throwing unhandled HTTP 500s. |

---

## 4. Native Hono Streaming Server Implementation Design (`openbot/server`)

### 4.1 Native Router Architecture (`src/copilot/native-router.ts`)

The native router replaces `@copilotkit/runtime`'s `createCopilotHonoHandler`. It handles parameter decoding, session verification, agent resolution, database lock acquisition, and SSE streaming:

```typescript
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import type { PostgresAgentRunner } from "../threads/postgres-runner";
import type { ActorAgentResolver } from "../agents/agent-resolver";
import type { Actor } from "../auth/actor";

export interface NativeRouterOptions {
  runner: PostgresAgentRunner;
  resolver: ActorAgentResolver;
  identifyActor: (c: Context) => Promise<Actor>;
  generativeUiEnabled?: boolean;
}

/**
 * Normalizes message records from Postgres persistence to OpenAI format required
 * by @copilotkit/react-core/v2's ToolCallRenderer and headless hooks.
 */
function normalizeMessagesForHydration(rawMessages: any[]): any[] {
  return rawMessages.map((m) => {
    const msg: any = {
      id: m.id,
      role: m.role,
    };

    // Omit empty content on assistant messages to prevent markdown renderer crashes
    if (m.content !== undefined && m.content !== null && (m.content !== "" || m.role !== "assistant")) {
      msg.content = m.content;
    }

    // Normalize tool calls to OpenAI function calling format
    if (m.toolCalls && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      msg.toolCalls = m.toolCalls.map((tc: any) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.function?.name ?? tc.name,
          arguments: typeof (tc.function?.arguments ?? tc.args) === "string"
            ? (tc.function?.arguments ?? tc.args)
            : JSON.stringify(tc.function?.arguments ?? tc.args ?? {}),
        },
      }));
    }

    if (m.toolCallId) {
      msg.toolCallId = m.toolCallId;
    }

    // Preserve activityType for role: "activity" messages per @copilotkit/react-core/v2 ActivityMessageSchema
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
  const router = new Hono().basePath("/api/copilotkit");

  // 1. Info discovery route
  router.get("/info", async (c) => {
    const actor = await options.identifyActor(c);
    const availableAgentsRecord = await options.resolver.resolveAgentsForActor(actor);
    const agentMap: Record<string, unknown> = {};

    for (const [id, agent] of Object.entries(availableAgentsRecord)) {
      agentMap[id] = {
        name: (agent as any).name || id,
        description: (agent as any).description || "",
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
  });

  // 2. Run agent execution turn (Streaming SSE)
  router.post("/agent/:agentId/run", async (c) => {
    const agentId = decodeURIComponent(c.req.param("agentId"));
    const rawBody = await c.req.json();
    const input = RunAgentInputSchema.parse(rawBody);
    const actor = await options.identifyActor(c);
    const agent = await options.resolver.resolveAgentForActor(actor, agentId);

    if (!agent) {
      return c.json({ error: `Agent '${agentId}' not found or unauthorized` }, 404);
    }

    // Contention Precondition: Check lock BEFORE initiating streamSSE.
    // If the thread is actively processing another run, reject immediately with HTTP 409 Conflict.
    const isBusy = await options.runner.isThreadRunning(input.threadId);
    if (isBusy) {
      return c.json(
        {
          error: "Thread is currently processing an active run",
          code: "THREAD_LOCKED",
          threadId: input.threadId,
        },
        409
      );
    }

    return streamSSE(c, async (stream) => {
      // Return explicit Promise so Hono does NOT close the SSE stream prematurely.
      return new Promise<void>((resolve) => {
        // Periodic keepalive comment every 15 seconds to prevent gateway timeouts
        const keepAliveTimer = setInterval(async () => {
          try {
            await stream.write(": keep-alive\n\n");
          } catch {
            clearInterval(keepAliveTimer);
          }
        }, 15_000);

        const event$ = options.runner.run({
          threadId: input.threadId,
          agent,
          input,
        });

        const subscription = event$.subscribe({
          next: async (event) => {
            try {
              await stream.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch {
              subscription.unsubscribe();
              clearInterval(keepAliveTimer);
              resolve();
            }
          },
          error: async (err) => {
            clearInterval(keepAliveTimer);
            const errorPayload = {
              type: "RUN_ERROR",
              timestamp: Date.now(),
              message: err instanceof Error ? err.message : String(err),
              code: "RUN_EXECUTION_FAILED",
            };
            try {
              await stream.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
            } catch {
              // stream disconnected
            }
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
      const activeRunId = await options.runner.getActiveRunId(body.threadId);
      if (!activeRunId) {
        return c.body(null, 204);
      }
      return c.json({ runId: activeRunId }, 200);
    }

    // Mode B: Stream replay and follow with explicit Promise
    return streamSSE(c, async (stream) => {
      return new Promise<void>((resolve) => {
        const event$ = options.runner.connect({
          threadId: body.threadId,
          agentId,
        });

        const sub = event$.subscribe({
          next: async (event) => {
            try {
              await stream.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch {
              sub.unsubscribe();
              resolve();
            }
          },
          error: async (err) => {
            try {
              await stream.write(`data: ${JSON.stringify({ type: "RUN_ERROR", message: err.message })}\n\n`);
            } catch {
              // stream disconnected
            }
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

  // 4. Stop active agent run (strictly conforming to wire contract)
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
      200
    );
  });

  // 5. Thread message history hydration
  router.get("/threads/:threadId/messages", async (c) => {
    const threadId = decodeURIComponent(c.req.param("threadId"));
    const actor = await options.identifyActor(c);
    const rawMessages = await options.runner.readThreadMessages(threadId, actor.id);
    const normalizedMessages = normalizeMessagesForHydration(rawMessages);
    return c.json({ messages: normalizedMessages }, 200);
  });

  return router;
}
```

---

### 4.2 Database Persistence, Runner Base Class, & Event Finalizer

#### Native `AgentRunner` Base Class (`src/threads/runner-base.ts`)
Decouples `PostgresAgentRunner` from `@copilotkit/runtime/v2`:

```typescript
import type { Observable } from "rxjs";
import type { AbstractAgent, BaseEvent, Message } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/core/schemas";

export interface AgentRunnerRunRequest {
  threadId: string;
  agent: AbstractAgent;
  input: RunAgentInput;
}

export interface AgentRunnerConnectRequest {
  threadId: string;
  agentId: string;
}

export interface AgentRunnerStopRequest {
  threadId: string;
  runId?: string;
}

export abstract class AgentRunner {
  abstract run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  abstract connect(request: AgentRunnerConnectRequest): Observable<BaseEvent>;
  abstract stop(request: AgentRunnerStopRequest): Promise<void>;
  abstract isThreadRunning(threadId: string): Promise<boolean>;
  abstract getActiveRunId(threadId: string): Promise<string | null>;
  abstract readThreadMessages(threadId: string, actorId: string): Promise<Message[]>;
}
```

#### In-Repo `finalizeRunEvents` (`src/threads/event-finalizer.ts`)
When a turn is stopped, times out, or throws an unhandled error, open tool calls (where `TOOL_CALL_START` was emitted without matching `TOOL_CALL_END` or `TOOL_CALL_RESULT`) must be formally closed. Without finalization, frontend tool cards stay spinning in an executing state indefinitely.

```typescript
import type { BaseEvent } from "@ag-ui/client";

/**
 * Scans an event buffer upon turn conclusion/interruption and synthesizes closing
 * tool call events for any pending or hanging tool invocations.
 */
export function finalizeRunEvents(
  events: BaseEvent[],
  reason: "cancelled" | "error" | "timeout" = "cancelled"
): BaseEvent[] {
  const finalized = [...events];
  const openToolCalls = new Map<string, { name?: string; messageId?: string }>();

  for (const event of events) {
    if (event.type === "TOOL_CALL_START") {
      openToolCalls.set((event as any).toolCallId, {
        name: (event as any).toolCallName,
        messageId: (event as any).parentMessageId,
      });
    } else if (event.type === "TOOL_CALL_END" || event.type === "TOOL_CALL_RESULT") {
      openToolCalls.delete((event as any).toolCallId);
    }
  }

  // Synthesize closing events for hanging tool calls
  const now = Date.now();
  for (const [toolCallId] of openToolCalls) {
    finalized.push({
      type: "TOOL_CALL_END",
      timestamp: now,
      toolCallId,
    } as BaseEvent);

    finalized.push({
      type: "TOOL_CALL_RESULT",
      timestamp: now,
      messageId: `msg_${toolCallId}_result`,
      toolCallId,
      role: "tool",
      content: `[Tool execution halted: run was ${reason}]`,
    } as BaseEvent);
  }

  return finalized;
}
```

#### Distributed Locking & Lease Mechanics (`PostgresAgentRunner`)
1. **Atomic Lock Acquisition**:
   Before initiating a run turn, the server executes:
   ```sql
   INSERT INTO agent_thread_locks (thread_id, run_id, owner, expires_at, heartbeat_at)
   VALUES ($1, $2, $3, now() + interval '120 seconds', now())
   ON CONFLICT (thread_id) DO UPDATE SET
     run_id = EXCLUDED.run_id,
     owner = EXCLUDED.owner,
     expires_at = EXCLUDED.expires_at,
     heartbeat_at = now()
   WHERE agent_thread_locks.expires_at <= now()
      OR agent_thread_locks.run_id = EXCLUDED.run_id
   RETURNING thread_id;
   ```
   If no row is returned, HTTP 409 Conflict / run refusal is triggered.
2. **Heartbeat Maintenance**: Every 20 seconds, the active turn executes `renewThreadLock`. If the renewal returns false (lock lost to timeout), the runner sets `writeError`, calls `agent.abortRun()`, logs `local-thread-lock-lost`, and terminates execution.
3. **Crash Recovery (`hydrate()`)**: Upon server boot, `PostgresAgentRunner.hydrate()`:
   - Updates all runs marked `status = 'running'` to `status = 'failed'` with the error: `"The server restarted while this run was in progress"`.
   - Deletes all dangling records from `agent_thread_locks`.
   - Caches thread records in memory for high-throughput reads.

---

### 4.3 Replacement of `@copilotkit/aimock` with In-Repo Test Mocks

To remove `@copilotkit/aimock` without breaking 11 integration test suites, native in-repo mocks are placed in `openbot/server/tests/mocks/`:
1. **`LLMock` (`tests/mocks/llmock.ts`)**:
   A lightweight Hono HTTP server running on an ephemeral port. Simulates OpenAI and Anthropic `/v1/chat/completions` endpoints, supporting chunked streaming SSE text tokens and tool call emissions.
2. **`MCPMock` (`tests/mocks/mcpmock.ts`)**:
   Emulates Model Context Protocol HTTP/SSE servers, responding to `tools/list` and `tools/call`.
3. **`AGUIMock` (`tests/mocks/aguimock.ts`)**:
   Emulates external AG-UI HTTP agents (`POST /ag-ui`), streaming JSON-encoded `BaseEvent` objects.

---

### 4.4 Complete Server-Side `@copilotkit/runtime` Decoupling Inventory

All 10 server-side files importing `@copilotkit/runtime/v2` are refactored according to the following decoupling specifications:

1. **`openbot/server/src/threads/postgres-runner.ts`**:
   - *Current*: Extends `AgentRunner` from `@copilotkit/runtime/v2`; imports `finalizeRunEvents`, request types, and `LocalThreadEndpointRecord`.
   - *Target*: Extends native `AgentRunner` from `./runner-base.ts`; imports `finalizeRunEvents` from `./event-finalizer.ts`; defines `LocalThreadEndpointRecord` locally.
2. **`openbot/server/src/openduet/reply-turn.ts`**:
   - *Current*: Imports `resolveModel` from `@copilotkit/runtime/v2` (lines 3 & 469).
   - *Target*: Implements native model resolution using `@openbot/server/src/models/provider.ts` or Vercel AI SDK provider factory (`openai(model)`, `anthropic(model)`).
3. **`openbot/server/src/agents/plan-model.ts`**:
   - *Current*: Imports `BuiltInAgentClassicConfig` from `@copilotkit/runtime/v2` to extract `PlanLanguageModel` (lines 4 & 13).
   - *Target*: Defines `PlanLanguageModel` directly using Vercel AI SDK `LanguageModelV1` interface (`specificationVersion: "v1" | "v3"`).
4. **`openbot/server/src/learning/runtime.ts`**:
   - *Current*: Imports `formatSkillCatalog, loadSkill, readSkillFile, SkillRegistry` from `@copilotkit/runtime/internal/learned-skills` and `type CopilotKitIntelligence` from `@copilotkit/runtime/v2`.
   - *Target*: Implements self-contained skill catalog formatting and file loading directly in `src/learning/runtime.ts` (reading YAML/Markdown files); replaces `CopilotKitIntelligence` with local database storage.
5. **`openbot/server/src/learning/auto-assign.ts`**:
   - *Current*: Imports `CopilotKitIntelligence` from `@copilotkit/runtime/v2`.
   - *Target*: Assigns skills directly to agent records in PostgreSQL without cloud intelligence calls.
6. **`openbot/server/src/learning/routes.ts`**:
   - *Current*: Imports `type CopilotKitIntelligence` from `@copilotkit/runtime/v2`.
   - *Target*: Replaced with local database query routes.
7. **`openbot/server/src/memory/intelligence.ts`**:
   - *Current*: Imports `type CopilotKitIntelligence` from `@copilotkit/runtime/v2` for `IntelligenceMemoryClient`.
   - *Target*: Defines `LocalMemoryClient` backed by local PostgreSQL vector / key-value schema (`src/memory/local-memory.ts`).
8. **`openbot/server/src/self-host-banner.ts`**:
   - *Current*: Imports `type CopilotKitIntelligence` to verify remote entitlement tier.
   - *Target*: Checks local deployment configuration / license file; renders sovereign self-hosted banner without remote network probes.
9. **`openbot/server/src/intelligence-client.ts`**:
   - *Current*: Imports and proxies `CopilotKitIntelligence`.
   - *Target*: Replaced with a local sovereign client stub conforming to the interface without making external network calls.
10. **`openbot/server/src/agents/handoff-wiring.ts`**:
    - *Current*: Imports `IntelligenceAgentRunner` from `@copilotkit/runtime/v2`.
    - *Target*: Replaces `IntelligenceAgentRunner` with `PostgresAgentRunner`.
11. **`openbot/server/src/index.ts`**:
    - *Current*: Imports types and runtime setup from `@copilotkit/runtime/v2`.
    - *Target*: Mounts `createNativeCopilotRouter` using `PostgresAgentRunner`.

---

### 4.5 Server Config & Sovereign Default Boot

In `openbot/server/src/config.ts`:
1. **Default Mode**: `runtimeCapabilities` defaults unconditionally to `mode: "local"`:
```typescript
function runtimeCapabilities(environment: Environment): RuntimeCapabilities {
  // Sovereign native local mode is the default
  return {
    mode: "local",
    durableHistory: true,
  };
}
```
2. **Purge Mandatory Cloud Check**: Lines 1025–1037 (which threw `Error: CopilotKit Intelligence is required and is not configured. Missing: ...`) are **deleted**.
3. **Index Boot**: In `openbot/server/src/index.ts`, `localRunner` is instantiated as the primary production runner, eliminating the gate that threw when `OPENBOT_LOCAL_MODE` was absent. The server boots cleanly with zero `INTELLIGENCE_*` variables present.
4. **Sovereign Local Mode Default & Zero Cloud Entitlement Queries**:
   In `openbot/server/src/config.ts`:
   - Evaluate `localMode` as:
     ```typescript
     localMode: localModeEnabled(environment) || runtimeCapabilities(environment).mode === "local",
     ```
     and update helper `localModeEnabled(environment)` to default to `true` when `OPENBOT_LOCAL_MODE` is unconfigured.
   - In `openbot/server/src/openduet/setup.ts`, the initialization query `askIntelligence` directly checks `input.config.localMode`:
     ```typescript
     const askIntelligence = () =>
       input.config.localMode
         ? Promise.resolve({ state: "not_required" } as IntelligenceFact)
         : withinTime(input.entitlements(), INTELLIGENCE_TIMEOUT_MS).then(
             intelligenceFact,
           );
     ```
     By defaulting `config.localMode` to `true` whenever native mode is active, `setup.ts` immediately resolves `{ state: "not_required" }` and **never initiates an outbound call to `api.intelligence.copilotkit.ai`**, preventing initialization crashes or unconfigured credential errors even when `OPENBOT_LOCAL_MODE` is not explicitly set in the host environment.
   - In `openbot/server/src/config.ts:1476`, evaluate `selfHostBanner: !(localModeEnabled(environment) || runtimeCapabilities(environment).mode === "local") && selfHostBannerEnabled(environment)` so the self-hosted banner is suppressed by default on local installations.

---

## 5. Toolkit Decoupling & Migration (`openbot/toolkit`)

### 5.1 Production Architecture of `NativeBuiltInAgent`

To replace `BuiltInAgent` from `@copilotkit/runtime/v2`, `NativeBuiltInAgent` is implemented in `openbot/toolkit/src/agents/builtin.ts` using Vercel AI SDK. It adds `ai: ^3.4.0` and `@ai-sdk/openai: ^0.0.60` to `openbot/toolkit/package.json`.

It provides complete message conversion, tool-calling loops, text framing (`TEXT_MESSAGE_START`/`END`), and human approval resumption (`input.resume`):

```typescript
import { AbstractAgent, type Message, type RunAgentInput, type BaseEvent } from "@ag-ui/client";
import { Observable } from "rxjs";
import { streamText, type CoreMessage, type ToolSet } from "ai";
import { openai } from "@ai-sdk/openai";

export interface NativeBuiltInAgentConfig {
  model: string;
  systemPrompt?: string;
  tools?: ToolSet;
  maxSteps?: number;
}

export class NativeBuiltInAgent extends AbstractAgent {
  constructor(
    public readonly agentId: string,
    public readonly config: NativeBuiltInAgentConfig
  ) {
    super();
  }

  public run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const abortController = new AbortController();

      (async () => {
        try {
          subscriber.next({
            type: "RUN_STARTED",
            timestamp: Date.now(),
            threadId: input.threadId,
            runId: input.runId,
            protocolVersion: "1.0",
          } as BaseEvent);

          // 1. Convert messages and synthesize resolved resumes
          const coreMessages = this.convertMessagesToAiSdk(input.messages);

          if (input.resume && input.resume.length > 0) {
            for (const item of input.resume) {
              coreMessages.push({
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: item.interruptId,
                    toolName: (item as any).toolName || "approval",
                    result: item.action === "resolve" ? (item.payload ?? "Approved") : "User rejected approval",
                  },
                ],
              });
            }
          }

          // 2. Stream execution using Vercel AI SDK fullStream
          const result = streamText({
            model: openai(this.config.model),
            system: this.config.systemPrompt,
            messages: coreMessages,
            tools: this.config.tools,
            maxSteps: this.config.maxSteps ?? 8,
            abortSignal: abortController.signal,
          });

          let textMessageStarted = false;
          let textStepCount = 0;
          let currentMessageId = `msg_${input.runId}`;
          const pendingInterrupts: Array<{ id: string; reason: string }> = [];

          for await (const part of result.fullStream) {
            switch (part.type) {
              case "text-delta": {
                if (!textMessageStarted) {
                  textStepCount++;
                  currentMessageId = `msg_${input.runId}_${textStepCount}`;
                  subscriber.next({
                    type: "TEXT_MESSAGE_START",
                    timestamp: Date.now(),
                    messageId: currentMessageId,
                    role: "assistant",
                  } as BaseEvent);
                  textMessageStarted = true;
                }
                subscriber.next({
                  type: "TEXT_MESSAGE_CONTENT",
                  timestamp: Date.now(),
                  messageId: currentMessageId,
                  delta: part.textDelta,
                } as BaseEvent);
                break;
              }

              case "tool-call": {
                if (textMessageStarted) {
                  subscriber.next({
                    type: "TEXT_MESSAGE_END",
                    timestamp: Date.now(),
                    messageId: currentMessageId,
                  } as BaseEvent);
                  textMessageStarted = false;
                }

                subscriber.next({
                  type: "TOOL_CALL_START",
                  timestamp: Date.now(),
                  toolCallId: part.toolCallId,
                  toolCallName: part.toolName,
                  parentMessageId: currentMessageId,
                } as BaseEvent);

                subscriber.next({
                  type: "TOOL_CALL_ARGS",
                  timestamp: Date.now(),
                  toolCallId: part.toolCallId,
                  delta: JSON.stringify(part.args ?? {}),
                } as BaseEvent);

                subscriber.next({
                  type: "TOOL_CALL_END",
                  timestamp: Date.now(),
                  toolCallId: part.toolCallId,
                } as BaseEvent);

                // If tool is a client tool or requires human approval, record interrupt
                if (!this.config.tools || !(part.toolName in this.config.tools)) {
                  pendingInterrupts.push({
                    id: part.toolCallId,
                    reason: "tool_approval_required",
                  });
                }
                break;
              }

              case "tool-result": {
                subscriber.next({
                  type: "TOOL_CALL_RESULT",
                  timestamp: Date.now(),
                  messageId: `msg_${part.toolCallId}_result`,
                  toolCallId: part.toolCallId,
                  role: "tool",
                  content: typeof part.result === "string" ? part.result : JSON.stringify(part.result),
                } as BaseEvent);
                break;
              }
            }
          }

          if (textMessageStarted) {
            subscriber.next({
              type: "TEXT_MESSAGE_END",
              timestamp: Date.now(),
              messageId: currentMessageId,
            } as BaseEvent);
          }

          // Emit RUN_FINISHED with strict @ag-ui/core schema conformance
          if (pendingInterrupts.length > 0) {
            subscriber.next({
              type: "RUN_FINISHED",
              timestamp: Date.now(),
              threadId: input.threadId,
              runId: input.runId,
              outcome: {
                type: "interrupt",
                interrupts: pendingInterrupts,
              },
            } as BaseEvent);
          } else {
            subscriber.next({
              type: "RUN_FINISHED",
              timestamp: Date.now(),
              threadId: input.threadId,
              runId: input.runId,
              outcome: { type: "success" },
            } as BaseEvent);
          }

          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();

      return () => abortController.abort();
    });
  }

  public clone(): this {
    return new (this.constructor as any)(this.agentId, { ...this.config });
  }

  private convertMessagesToAiSdk(messages: Message[]): CoreMessage[] {
    const coreMessages: CoreMessage[] = [];

    for (const m of messages) {
      if (m.role === "user") {
        coreMessages.push({
          role: "user",
          content: m.content || "",
        });
      } else if (m.role === "system") {
        coreMessages.push({
          role: "system",
          content: m.content || "",
        });
      } else if (m.role === "tool") {
        coreMessages.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: (m as any).toolCallId || "unknown",
              toolName: (m as any).toolName || (m as any).name || "tool",
              result: m.content || "",
            },
          ],
        });
      } else if (m.role === "assistant") {
        if ((m as any).toolCalls && (m as any).toolCalls.length > 0) {
          const parts: any[] = [];
          if (m.content) {
            parts.push({ type: "text", text: m.content });
          }
          for (const tc of (m as any).toolCalls) {
            const rawArgs = tc.function?.arguments ?? tc.args;
            let parsedArgs = {};
            if (typeof rawArgs === "string") {
              try {
                parsedArgs = JSON.parse(rawArgs || "{}");
              } catch {
                parsedArgs = {};
              }
            } else if (rawArgs && typeof rawArgs === "object") {
              parsedArgs = rawArgs;
            }

            parts.push({
              type: "tool-call",
              toolCallId: tc.id,
              toolName: tc.function?.name ?? tc.name,
              args: parsedArgs,
            });
          }
          coreMessages.push({
            role: "assistant",
            content: parts,
          });
        } else {
          coreMessages.push({
            role: "assistant",
            content: m.content || "",
          });
        }
      }
    }

    return coreMessages;
  }
}
```

---

### 5.2 Refactoring `BuiltInAgentWithSaneHistory`

`BuiltInAgentWithSaneHistory` is updated to extend `NativeBuiltInAgent`, preserving all load-bearing conversation protection features:
1. **Dangling Tool Call Sanitization (`sanitizeSeededHistory`)**:
   Scans `input.messages`. If an assistant message contains a tool call with no matching `tool` result before the next turn, and the call is not in `input.resume`, the call is stripped. Empty assistant messages are pruned. This completely prevents `AI_MissingToolResultsError`.
2. **Multimodal Attachment Inlining (`hooks.inline`)**:
   Replaces `/api/attachments/:id` URLs with raw base64 data parts, strictly enforcing the per-run budget `MAX_INLINED_BYTES_PER_RUN`.
3. **Native Approval Suspensions (`nativeApprovalRun`)**:
   Wraps execution in `AsyncLocalStorage`. If a tool invocation requires human approval, throws `HeadlessToolSuspension`, which catches the error and emits `EventType.CUSTOM` (`openbot.headless.waiting`) followed by `RUN_FINISHED` with `outcome: { type: "interrupt", interrupts: [{ id: toolCallId, reason: "tool_approval_required" }] }`.

---

### 5.3 Thread Locking Modernization & Clean Monorepo Layering

To prevent illegal circular dependencies between monorepo workspace packages (`openbot/toolkit` must not depend on `openbot/server` or `drizzle-orm`):

1. **Abstract Port in `@openbot/toolkit` (`src/ports.ts`)**:
```typescript
export interface LockableThreadRunner {
  acquireLock(threadId: string, runId: string, timeoutMs: number): Promise<boolean>;
  renewLock(threadId: string, runId: string, extensionMs: number): Promise<boolean>;
  releaseLock(threadId: string, runId: string): Promise<void>;
  isThreadRunning(threadId: string): Promise<boolean>;
}

export interface ThreadLock {
  acquire(): Promise<boolean>;
  renew(): Promise<boolean>;
  release(): Promise<void>;
}
```

2. **Durable Postgres Lock Retained in `openbot/server`**:
   The concrete implementation `createDurableThreadLock` is retained in `openbot/server/src/threads/local-lock.ts` where it safely references `PostgresAgentRunner`. `@openbot/toolkit` has **zero dependencies** on `openbot/server`.

3. **Phase 1 Retains `@deprecated` Shims for Clean Phase 2 Rollback**:
   In `openbot/toolkit`, rather than deleting `createIntelligenceThreadLock` and `IntelligenceKnowingANewThread` immediately during Phase 1, retain them as `@deprecated` shims in `openbot/toolkit/src/copilotkit/*`:
   - `createIntelligenceThreadLock` adapts calls to `LockableThreadRunner` with an in-memory fallback.
   - `IntelligenceKnowingANewThread` returns a local empty thread descriptor without external cloud intelligence queries.
   This guarantees that if Phase 2 fails or requires rollback, `openbot/server/src/copilot.ts` (which imports these symbols from `@openbot/toolkit/copilotkit/*`) will compile cleanly against `@openbot/toolkit` without forcing a simultaneous rollback of toolkit packages. The shims will be formally pruned only after Phase 2 is validated in production. `openbot/toolkit/tests/thread-lock.test.ts` tests both the modern `LockableThreadRunner` port and the compatibility shim.

4. **LangGraph Microservice Decoupling**:
   As verified in Section 2.3, LangGraph services (`openbot/agent-langgraph` and `openbot/agent-langgraph-agui`) communicate over native AG-UI HTTP protocol (`POST /ag-ui`). They never imported `@copilotkit/runtime`. Their integration remains 100% operational and requires zero modifications.

---

## 6. Desktop Decoupling (`openbot/desktop`)

### 6.1 Rust Core Telemetry Decoupling (`telemetry.rs` & `desktop_telemetry.rs`)

1. **Endpoint Suppression**:
   - In `openbot/desktop/src-tauri/src/desktop_telemetry.rs:23`, remove the hardcoded fallback URL `"https://telemetry.copilotkit.ai/ingest"`, setting `endpoint: None`.
   - In `openbot/desktop/src-tauri/src/telemetry.rs`, update `telemetry::Config` so default endpoint is `None`. When endpoint is `None` or `COPILOTKIT_TELEMETRY_DISABLED=1`, `telemetry::Telemetry::open()` returns a disabled `Telemetry` struct.
2. **Header Removal**:
   Remove emission of header `X-CopilotKit-Telemetry-Id: <uuid>`.
3. **Local IPC Logging**:
   In `openbot/desktop/src-tauri/src/desktop_telemetry.rs`, command `record_setup_event` routes to `tracing::info!(target: "desktop::setup", ...)` without buffering or scheduling background HTTP dispatch tasks.

---

### 6.2 Rust Core Cloud Intelligence Decoupling & Startup Guard (`main.rs` & `intelligence.rs`)

1. **Desktop Startup Guard in `main.rs:1007–1024, 1414`**:
   In `openbot/desktop/src-tauri/src/main.rs`, update `intelligence_key_for_start`:
   ```rust
   fn intelligence_key_for_start(
       root: &Path,
       given: String,
       mut resolve: impl FnMut(&Path, &str) -> Result<String, Problem>,
   ) -> Result<String, Problem> {
       let key = if given.trim().is_empty() {
           resolve(root, "INTELLIGENCE_API_KEY").unwrap_or_default()
       } else {
           given
       };
       // In sovereign local mode, allow stack to boot with a local dummy key
       if key.trim().is_empty() {
           return Ok("local-sovereign-key".to_string());
       }
       Ok(key)
   }
   ```
   This prevents `Problem::connection(Connection::Intelligence)` from triggering a setup loop when cloud keys are omitted.

2. **Decoupled Tauri Commands (`intelligence.rs`)**:
   - `begin_intelligence_sign_in`: Returns a local loopback status `{ "url": "http://127.0.0.1/local-auth", "state": "local" }`.
   - `finish_intelligence_sign_in`: Returns a static local project record `[{"id": 1, "name": "Local OpenDuet Engine"}]`.
   - `intelligence_key_for`: Returns `"local-sovereign-key"`.
   - `create_intelligence_project`: Returns `{"id": 1, "name": "Local OpenDuet Engine"}`.

3. **Environment Generation (`env.rs`)**:
   - In `openbot/desktop/src-tauri/src/env.rs:compose`, inject `env.insert("OPENBOT_LOCAL_MODE".into(), "true".into());` into the compose environment dictionary written for Docker containers, guaranteeing the server container boots in sovereign local mode.
   - Remove mandatory inclusion of `INTELLIGENCE_API_KEY`, `INTELLIGENCE_API_URL`, and `INTELLIGENCE_GATEWAY_WS_URL`.
   - Update tests in `openbot/desktop/src-tauri/src/main.rs:4784–4796` to assert that sovereign local keys successfully authenticate engine start without requiring `Connection::Intelligence`.

---

### 6.3 Desktop Setup Wizard Decoupling (`App.tsx`)

In `openbot/desktop/src/App.tsx`:

1. **Setup Progress Feedback on Model Selection**:
   In `<ProviderPicker>` on the `model` step (lines 893–915), render `<SetupProgress steps={steps} />` when `busy` is true:
   ```tsx
   if (!running && step === "model") {
     return (
       <main>
         <ProviderPicker
           held={alreadyHeld}
           root={root}
           chosen={model}
           returning={returningToInstallation}
           busy={busy}
           onChoose={(choice) => {
             recordSetupEvent(modelChoiceEvent(choice));
             setModel(choice);
             void start(choice);
           }}
           onBack={() => {
             setSteps([]);
             setStep(returningToInstallation ? "connect" : "install");
           }}
         />
         {busy && <SetupProgress steps={steps} />}
         {displayedFailure && <Failure problem={displayedFailure} />}
       </main>
     );
   }
   ```
   Rendering `<SetupProgress>` provides essential visual feedback while `start(choice)` initializes and downloads Docker containers.

2. **Direct Advance on Model Choice**:
   Lines 902–907:
   ```typescript
   onChoose={(choice) => {
     recordSetupEvent(modelChoiceEvent(choice));
     setModel(choice);
     // In sovereign local mode, bypass connect and boot stack immediately
     void start(choice);
   }}
   ```
   When the user chooses their model (OpenAI, Anthropic, Ollama), clicking "Continue" bypasses the cloud connect screen, executes `start(choice)` (setting `running = true` and booting the engine), and advances directly to `"ask"` (via line 594).

3. **Returning Launch Route Fix**:
   In `openbot/desktop/src/App.tsx` line 580:
   ```typescript
   if (
     savedLaunch.current === installationKey ||
     organizationAuthorityUrl?.trim()
   ) {
     savedLaunch.current = installationKey;
     setStep("ask"); // Route returning launches to "ask" instead of legacy "connect"
     setRefreshIntelligence(false);
     await invoke("show_openbot");
     return;
   }
   ```
   Changing line 580 from `setStep("connect")` to `setStep("ask")` prevents returning users from being stranded on the deprecated cloud connection screen upon application re-launch.

---

## 7. Deployment & Infrastructure Migration

### 7.1 Environment Variable Purge
Purge the following variables from `.env.example`, `openbot/Dockerfile`, `openbot/server/Dockerfile`, and `docker-compose.yml`:

```bash
# REMOVED: CopilotKit Cloud Intelligence & Remote Gateway
- INTELLIGENCE_API_URL=https://api.intelligence.copilotkit.ai
- INTELLIGENCE_GATEWAY_WS_URL=wss://realtime.intelligence.copilotkit.ai
- INTELLIGENCE_API_KEY=...
- CPK_INTELLIGENCE_API_KEY=...
- CPK_INTELLIGENCE_LEARNING_CONTAINER_ID=...
- OPENBOT_LEARNING_AUTO_ASSIGN=true
- INTELLIGENCE_SERVICE_TOKEN=...
- INTELLIGENCE_PROJECT_ID=...

# REMOVED: CopilotKit Telemetry & License Entitlement
- CPK_TELEMETRY_ID=...
- COPILOTKIT_TELEMETRY_SAMPLE_RATE=1
- COPILOTKIT_LICENSE_TOKEN=...
- OPENBOT_SELF_HOST_BANNER=...
```

---

### 7.2 Kubernetes Helm Chart Migration (`openbot/charts/openbot`)

1. **`templates/validation.yaml`**:
   - Delete refusal check at line 81:
     ```yaml
     {{- fail "OpenBot requires CopilotKit Intelligence. Set config.intelligence.apiUrl..." }}
     ```
   - Delete lines 392–399 validating `learning.setup.serviceTokenSecret` and `projectId`.
2. **`templates/learning/setup-job.yaml`**:
   - Delete this entire template file from the chart.
3. **`templates/secret.yaml` & `templates/server/deployment.yaml`**:
   - Remove `intelligence-api-key` secret key and `INTELLIGENCE_*` container environment bindings.
4. **`values.yaml`**:
   - Remove `config.intelligence` and `config.learning.setup` sections.
   - Remove `secrets.intelligenceApiKey` and `secrets.licenseToken`.
5. **`ci/*-values.yaml`**:
   - Remove dummy `intelligenceApiKey` entries across AKS, EKS, GKE, and self-hosted CI values.
6. **Legacy Chart Rollback Safeguard**:
   Legacy versions of `openbot/charts/openbot/templates/validation.yaml` enforce:
   ```yaml
   {{- if or (not .Values.config.intelligence.apiUrl) (not .Values.config.intelligence.gatewayWsUrl) }}
   {{- fail "OpenBot requires CopilotKit Intelligence. Set config.intelligence.apiUrl and config.intelligence.gatewayWsUrl, and the matching secrets.intelligenceApiKey." }}
   {{- end }}
   ```
   Note that the Helm CLI command `helm rollback` rejects `--set` flags. When rolling back from the decoupled chart to a legacy release, an override values file must be provided via `--values`:
   ```bash
   helm rollback <release> <revision> --values rollback-overrides.yaml
   ```
   where `rollback-overrides.yaml` provides both URLs and the dummy key:
   ```yaml
   config:
     intelligence:
       apiUrl: https://localhost/mock-intelligence
       gatewayWsUrl: wss://localhost/mock-gateway
   secrets:
     intelligenceApiKey: dummy-key
   ```
   Omitting either `apiUrl` or `gatewayWsUrl` causes legacy Helm releases to abort with template validation failure.

---

### 7.3 Startup Scripts & CI/CD Pipeline Migration

1. **`openbot/scripts/start.sh`**:
   - Remove lines 495–520 inspecting `INFO="$(curl ... /api/copilotkit/info)"` for `licenseStatus === "valid"`.
   - Remove lines 364–376 calling `bun scripts/setup-learning.ts`.
   - Health check verifies server readiness via standard HTTP 200 response on `/api/copilotkit/info`.
2. **`.github/workflows/ci.yml`**:
   - In `image` test job (lines 598–606), remove injected dummy environment variables (`INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_API_KEY`).
   - In `chart` test job (lines 211–223), remove the test step checking that `Learning setup Job renders`.
   - In `chart` test job (lines 286–287), remove the refusal assertion:
     ```yaml
     refuses "a Learning service token with no project to create the container in" \
       --set-string config.learning.setup.serviceTokenSecret.name=intelligence-service-token
     ```

---

## 8. Phased Implementation Roadmap & Rollback Contingencies

### 8.1 Phased Implementation Roadmap

```
Phase 1: Foundation & Toolkit Decoupling
├── 1. Add ai and @ai-sdk/openai to openbot/toolkit/package.json
├── 2. Implement NativeBuiltInAgent in openbot/toolkit/src/agents/builtin.ts
├── 3. Refactor BuiltInAgentWithSaneHistory to extend NativeBuiltInAgent
├── 4. Define LockableThreadRunner port in openbot/toolkit/src/ports.ts
├── 5. Retain createIntelligenceThreadLock & IntelligenceKnowingANewThread in @openbot/toolkit as @deprecated shims
├── 6. Update openbot/toolkit/tests/thread-lock.test.ts to use port mock and verify shims
├── 7. Remove @copilotkit/runtime from openbot/toolkit/package.json
└── 8. Verify toolkit tests pass (bun test --cwd openbot/toolkit)

Phase 2: Native Hono Streaming Server & 10-Module Decoupling
├── 1. Implement native AgentRunner base class in openbot/server/src/threads/runner-base.ts
├── 2. Implement in-repo finalizeRunEvents in openbot/server/src/threads/event-finalizer.ts (mandatory messageId)
├── 3. Decouple PostgresAgentRunner from @copilotkit/runtime/v2
├── 4. Refactor 9 other server modules (reply-turn, plan-model, learning/*, memory, banner, etc.)
├── 5. Implement native Hono router in openbot/server/src/copilot/native-router.ts with 409 lock check & Promise
├── 6. Refactor server/src/config.ts to evaluate localMode default and purge line 1033 cloud check
├── 7. Implement in-repo mocks (LLMock, MCPMock, AGUIMock) in openbot/server/tests/mocks/
├── 8. Update telemetry.test.ts and purge devDependencies in root/server package.json
├── 9. Remove @copilotkit/runtime and @copilotkit/aimock from openbot/server/package.json
└── 10. Verify server tests pass (bun test --cwd openbot/server)

Phase 3: Desktop Decoupling (Telemetry & Cloud Intelligence)
├── 1. Suppress X-CopilotKit-Telemetry-Id and cloud ingest in desktop_telemetry.rs:23 & telemetry.rs
├── 2. Update main.rs:1007, 1414 (intelligence_key_for_start) to allow local sovereign key
├── 3. Replace Tauri IPC intelligence commands with local stubs in intelligence.rs
├── 4. Update desktop/src/App.tsx: route returning launches (line 580) to "ask", render SetupProgress in ProviderPicker, and advance model -> ask
└── 5. Add OPENBOT_LOCAL_MODE=true and remove INTELLIGENCE_* environment propagation in desktop env.rs

Phase 4: Deployment Configurations, Helm Chart & CI Purge
├── 1. Purge INTELLIGENCE_* and CPK_* variables from .env.example and Dockerfiles
├── 2. Delete openbot/charts/openbot/templates/learning/setup-job.yaml
├── 3. Purge CopilotKit refusal check from charts validation.yaml and values.yaml
├── 4. Purge lines 286-287 from .github/workflows/ci.yml
├── 5. Update openbot/scripts/start.sh to remove license token checks
└── 6. Run full verification suite across all packages
```

---

### 8.2 Rollback Contingency Procedures

| Phase | Failure Trigger / Risk | Immediate Rollback Action | Fallback State |
| :--- | :--- | :--- | :--- |
| **Phase 1** | TypeScript compilation failure in toolkit or broken history sanitization. | Revert `BuiltInAgentWithSaneHistory` to previous git commit; restore `@copilotkit/runtime` in `toolkit/package.json`; run `bun install`. | Target A (Hybrid) |
| **Phase 2** | SSE stream stalling, client event parsing failure, or test breakages in server. | 1. Restore `"@copilotkit/runtime": "1.77.0"` and `"@copilotkit/aimock": "1.43.0"` in `openbot/server/package.json`.<br>2. Execute `bun install` to restore vendor modules.<br>3. Re-enable `mountLocalCopilotRuntime` in `src/copilot.ts` and revert `app.ts` mounting to `createCopilotHonoHandler`.<br>*(Note: Compiles cleanly because `@openbot/toolkit` retained `@deprecated` shims for `createIntelligenceThreadLock` and `IntelligenceKnowingANewThread` in Phase 1).* | Target A local SSE mode |
| **Phase 3** | Desktop wizard hang on model selection or Tauri IPC invocation crash. | Restore `intelligence_key_for_start` and allow `App.tsx` to display local bypass modal. | Local mock auth |
| **Phase 4** | Helm rollback failure due to legacy validation guard in older releases. | **Safe Helm Rollback CLI Syntax**: Because `helm rollback` rejects `--set`, pass a values file: `helm rollback <release> <revision> --values rollback-overrides.yaml` (or `helm upgrade <release> <chart-dir> --values rollback-overrides.yaml`) containing both `config.intelligence.apiUrl` and `config.intelligence.gatewayWsUrl` (and `secrets.intelligenceApiKey`). | Permissive Helm release |

---

## 9. Objective Verification Strategy

Every stage of implementation must be verified objectively using automated test runners, TypeScript typecheckers, and protocol verification scripts.

### 9.1 Package-by-Package Test Commands

#### 1. `openbot/toolkit` Verification
Tests conversation history sanitization, attachment inlining, lease heartbeats, and thread locking:
```bash
# Run all toolkit unit tests
bun test --cwd openbot/toolkit

# Run adversarial stress tests
bun test --cwd openbot/toolkit tests/adversarial-stress.test.ts tests/history-sanitize.test.ts
```

#### 2. `openbot/server` Verification
Tests Postgres runner persistence, cold crash recovery, tool selection, config boots, and endpoint routing:
```bash
# Run server test suites
bun test --cwd openbot/server tests/postgres-runner.integration.test.ts tests/cold-crash-recovery.integration.test.ts tests/agent-routes.test.ts

# Run copilot turn and tool integration tests
bun test --cwd openbot/server tests/copilot.test.ts tests/server-side-tools.integration.test.ts

# Run adversarial config boot test
bun test --cwd openbot/server tests/adversarial-config.test.ts
```

#### 3. TypeScript Typechecking
Verify zero type regressions across all monorepo packages:
```bash
# Server typecheck
bun run --cwd openbot/server typecheck

# Toolkit typecheck
bun run --cwd openbot/toolkit typecheck

# App (frontend) typecheck (confirms zero UI contract regressions)
bun run --cwd openbot/app typecheck

# Desktop typecheck
bun run --cwd openbot/desktop typecheck
```

#### 4. Kubernetes Helm Chart Verification
Verify Helm chart renders cleanly without intelligence secrets or learning setup jobs:
```bash
helm lint openbot/charts/openbot
helm template test-release openbot/charts/openbot --values openbot/charts/openbot/ci/self-hosted-values.yaml
```

#### 5. Local Orchestration Startup Verification
Verify the stack boots locally without license validation errors or cloud dependencies:
```bash
bash openbot/scripts/start.sh
```

---

### 9.2 Protocol Conformance Test Suite (`tests/protocol-compliance.ts`)

A dedicated protocol harness in `openbot/server` will validate wire fidelity against `/api/copilotkit`:
1. **Capabilities Probe**: Asserts `GET /api/copilotkit/info` returns 200 with `mode: "sse"` and `threadEndpoints.inspect: true`.
2. **Lock Contention Status**: Asserts `POST /api/copilotkit/agent/:id/run` returns `409 Conflict` when a thread is already running.
3. **SSE Format Conformance**: Asserts `POST /api/copilotkit/agent/:id/run` produces valid `data: <JSON>\n\n` frames parseable by `@ag-ui/client`.
4. **Keepalive Verification**: Asserts idle streams emit `: keep-alive\n\n` within 15 seconds without premature closure.
5. **Tool Suspension Handshake**: Asserts frontend tool execution produces `RUN_FINISHED` conforming to `RunFinishedInterruptOutcomeSchema` with `outcome.interrupts` (mandating at least 1 item and non-empty `reason: string`).
6. **Cancellation Signal**: Asserts `POST /api/copilotkit/agent/:id/stop/:threadId` terminates streaming within 500ms, releases the database lock, and returns `{ "stopped": true, "status": "stopped" }`.
7. **Hydration Normalization**: Asserts `GET /api/copilotkit/threads/:threadId/messages` normalizes tool calls to `{ type: "function", function: { name, arguments } }` with stringified arguments, and preserves `activityType: string` and `metadata` on `role: "activity"` messages.
8. **Tool Call Result Fidelity**: Asserts `TOOL_CALL_RESULT` always carries mandatory `messageId: string` to prevent `@ag-ui/client` event pipeline crashes.

---

### 9.3 Acceptance Criteria Sign-Off Checklist

- [x] **Subsystem Coverage**: All non-UI CopilotKit components mapped across `server` (all 10 modules), `toolkit`, `desktop`, and deployment configurations.
- [x] **Protocol Fidelity**: All 5 `/api/copilotkit` endpoints, request schemas, and 23 SSE events detailed with byte-level fidelity, including strict `RunFinishedInterruptOutcomeSchema` and OpenAI tool call hydration.
- [x] **Zero UI Changes**: Formal proof and verification that `openbot/app` requires zero code modifications.
- [x] **Native Hono Architecture**: Full implementation design for Hono streaming router with explicit Promise lifecycle, 409 lock checking, direct AG-UI agent runner, and PostgreSQL persistence.
- [x] **Toolkit Decoupling**: Complete production blueprint for `NativeBuiltInAgent extends AbstractAgent` using Vercel AI SDK `fullStream`, tool loops, and `LockableThreadRunner` port.
- [x] **Desktop Decoupling**: Concrete strategies for suppressing telemetry in `desktop_telemetry.rs:23` and `telemetry.rs`, updating `intelligence_key_for_start`, stubbing intelligence IPC, and triggering `start(choice)` in setup wizard.
- [x] **Deployment Purge**: Comprehensive inventory of pruned environment variables, Dockerfiles, and Helm charts, including CI refusal check at lines 286–287.
- [x] **Phased Roadmap & Realistic Rollback**: 4-phase incremental rollout with package re-installation rollback steps and safe Helm rollback flags.
- [x] **Objective Verification**: Exact executable test commands, typechecking, and protocol compliance harnesses.
