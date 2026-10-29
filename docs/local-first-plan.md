# Local-first migration plan

**Goal:** remove the CopilotKit Intelligence subscription and every CopilotKit cloud call, keep the platform, data, threads, memory, approvals, computers, and UI local, and use external APIs only for models.

**Status (2026-10-29):** Target A is implemented and verified for a single-user local install, including a real tool-using turn in the UI. The server runs the MIT runtime in local SSE mode; Postgres now holds threads, runs, events, messages, state, and locks; Mercury 3 handles generation and tools; and the decision model handles tool selection, safety review, routing, and triage. A conversation was sent, the server was restarted, and the same conversation history replayed in the UI. A due routine fired through the local worker and appended its turn to the same durable thread.

**Implemented today**

- `OPENBOT_LOCAL_MODE=true` removes the Intelligence requirement; local setup, the self-host banner, and `start.sh` understand local mode.
- `PostgresAgentRunner` persists every run, AG-UI event, message snapshot, state snapshot, and thread lease. Restart recovery closes interrupted runs, clears stale locks, and reloads the runtime's synchronous thread read model from Postgres. Message snapshots carry their array position, so a restart does not reorder a conversation.
- The runtime's local thread endpoints keep the same synchronous contract the app already calls; Postgres is the source of truth, the in-process cache is the read model, and `readThreadMessages` checks ownership for history reads. A single local API process is the supported shape.
- The native AG-UI router seeds `agent.messages`, `agent.state` and `agent.threadId` before `runner.run`, the way CopilotKit's HTTP handler did. Without that seeding the server-side agent began every turn with an empty conversation, saw only its system prompt, and answered each request with the same greeting. Assistant rows that are only a canned greeting are dropped from the model's copy of the history; substantive replies, user turns, tool calls and tool results are kept.
- A routine fired through the worker and appended its turn to the same durable thread. Handoff uses `copilotRuntime.runner`, `copilotRuntime.history`, and the durable `threadLock`; group chat uses the same `routineIntelligence` + `routineAgentRunner` pair.
- `bun run local:up`, `bun run local:status`, and `bun run local:down` start and stop the agent computer, server, worker, and app without Docker. Postgres is the only external local prerequisite.
- Mercury 3 is forced through OpenAI-compatible Chat Completions (not `/v1/responses`) for chat, streaming, JSON mode, and tool calls.
- A typed decision client supports `mercury-decide` (hosted), `mercury-3` as a compatibility path, and local `opendecider` or `laya`. The local stack runs `opendecider` with `DECISION_BASE_URL=in-process`, on the in-repo weights, so a decision costs no network hop.
- Decision-backed tool selection fails open; decision-backed safety review fails closed and can only add approval or hand-off. Decision-backed routing is authoritative over the roster and falls back to the default coworker; decision-backed triage is a typed `noul` and fails closed to "unsorted" rather than guessing "can wait".
- Chat titles in local mode are taken from the person's first line instead of a second model call.
- Decision, routing, triage, configuration, setup, selection, approval, title, durable-runner, routine, handoff, and group-chat tests pass; server and test typechecks pass.

**Not implemented yet**

- Safety, tool-selection, routing, and triage evals against all four decision providers.
- Multi-user isolation for the runtime's synchronous thread list endpoints. History reads are owner-checked; the runtime's own list route is still the single-user local shape.
- Multi-replica realtime (`LISTEN/NOTIFY` or another event bus). The current cache is single-process.
- Optional `DECISION_SAFETY_ALWAYS` preflight for writes when automatic review is off.
- A fully offline generative model; Mercury 3 remains an external API.

---

## 1. What "local" means here

There are three different claims, and they should not be mixed:

| Claim | What it means | Achievable? |
| --- | --- | --- |
| No CopilotKit subscription | No Intelligence project, no `INTELLIGENCE_*` keys, no licence check, no CopilotKit cloud threads/memory | Yes |
| All platform services local | App, API, worker, Postgres, computers, supervisor, thread store, memory, decision service all run on your machine | Yes |
| Fully offline | No external network at runtime | Only with a local generative model; Mercury 3 is an API |

The plan below achieves the first two. Mercury 3 remains an external API. If you also choose Mercury Decide for decisions, that is external too. If you use OpenDecider Nano or Laya, the decision layer stays local.

The MIT `@copilotkit/runtime` and `@copilotkit/react-core` packages are already local npm packages. They are not the subscription. The plan keeps them because replacing them would mean rewriting the interactive layer, and it would not remove a cloud dependency. If you want zero CopilotKit packages as well, that is Phase 7 and a separate project.

---

## 2. Decision summary

**Target A (recommended): no subscription, keep the MIT runtime.**

- `@copilotkit/runtime` runs in **SSE mode** instead of Intelligence mode.
- Threads, messages, events, state, and locks live in **Postgres**.
- Memory uses OpenBot's existing local tables.
- Learning and Intelligence entitlements are removed.
- A **decision service** handles tool selection and safety classification.
- Mercury 3 handles chat, tool calls, writing, and summaries.
- No CopilotKit account, CLI, key, licence, or telemetry is required.

**Target B (optional): no CopilotKit packages at all.**

- Replace `CopilotSseRuntime` with a custom AG-UI server.
- Replace `@copilotkit/react-core` with a custom React chat UI.
- Keep OpenBot's auth, policy, audit, approvals, computers, connectors, and channels.
- Much larger; only do it if a dependency or compliance requirement demands it.

The rest of this document plans Target A. Phase 7 sketches Target B.

---

## 3. Target architecture

```text
Browser
  React app, custom chat, CopilotKit react-core (local npm)
        │
        ▼
OpenBot server (Hono, local)
  ├── auth, roles, channels, approvals, policy, audit, credentials
  ├── local thread API ──────────────► Postgres
  ├── CopilotKit SSE runtime
  │     ├── run / connect / stop
  │     └── PostgresAgentRunner ─────► Postgres
  ├── decision service client
  │     ├── tool selection
  │     ├── safety review
  │     ├── routing
  │     └── triage
  └── model gateway
        ├── Mercury 3 API (generation, tool calls)
        └── decision model
              ├── OpenDecider Nano / Laya (local)
              └── Mercury Decide (API, optional)
        │
        ▼
Agent computer (Docker)
  Chromium · workspace · shell
```

Data flow:

1. Browser sends a turn to `/api/copilotkit/agent/:id/run`.
2. The runtime resolves the agent and calls `PostgresAgentRunner.run`.
3. The decision service narrows the tools offered to the agent.
4. Mercury 3 runs the turn and calls tools.
5. Every write action passes through the existing policy/approval gateway.
6. The decision service classifies the action’s safety; it may add friction, never remove it.
7. Events and messages are persisted to Postgres.
8. Browser reconnects through `/connect`, which replays persisted events.

---

## 4. Model roles

| Role | Model | Why |
| --- | --- | --- |
| Main agent | **Mercury 3** | Chat, tool calls, writing, multi-step work |
| Tool selection | **Decision model** | Fast typed yes/no over skills |
| Safety review | **Decision model** | Typed risk classification with probabilities |
| Routing | **Decision model** | Choice over the coworker roster |
| Triage | **Decision model** | Needs-you vs can-wait probability |
| Reasons, titles, summaries | **Mercury 3** | These need prose |
| Approval reason text | **Mercury 3** or template | The decision model does not generate text |

**Important boundary:** "tool deciding" means deciding which tools are exposed to Mercury 3 for a run. Mercury 3 still chooses and calls the tool. The decision model does not execute tools and does not replace the agent loop.

**Safety boundary:** the decision model may only **escalate** an action to approval or hand-off. It may never auto-approve something the deterministic policy, the keyword safety floor, or a matched rule would block.

---

## 5. Phase 0 — baseline and feature flag

**Deliverables**

- Add `OPENBOT_LOCAL_MODE=true` (default off until migration is complete).
- Add `RuntimeCapabilities.mode: "intelligence" | "local"`.
- Keep the Intelligence path behind the flag until the local path passes tests.
- Add a migration journal entry and a rollback switch.
- Freeze a baseline: current tests, triage eval scores, routing tests, approval tests.

**Files**

- `openbot/server/src/config.ts`
- `openbot/server/src/app.ts`
- `openbot/server/src/copilot.ts`

**Exit criteria**

- Both modes boot in CI.
- Existing Intelligence tests still pass.
- Local mode can be selected without changing code.

---

## 6. Phase 1 — model layer

### 6.1 Mercury 3

Configuration:

```env
OPENAI_BASE_URL=https://api.inceptionlabs.ai/v1
OPENAI_API_KEY=...
BOT_PROVIDER=openai
BOT_MODEL=mercury-3
AGENT_BOT_MODEL=mercury-3
```

Tenant package:

```yaml
# openbot/examples/openduet/model.yaml
model:
  provider: openai
  credential_secret_ref: openai-api-key
  default_model: mercury-3
```

Notes:

- `BOT_MODEL` overrides the tenant default when `OPENAI_BASE_URL` is set.
- Mercury 3 is Chat Completions, not the OpenAI Responses API. Do not set `BOT_RESPONSES_API=true`.
- Mercury 3 supports streaming and tool calls. Test both before trusting it.
- Mercury 3 temperature is 0.5–1.0. If the runtime sends 0, clamp or omit it.
- Leave `BOT_REASONING_EFFORT` unset initially; Mercury uses `instant | low | medium | high`, not the OpenAI values.

**Smoke test, before touching the app:**

1. `POST /v1/chat/completions` with a plain user message.
2. Same with `stream: true`.
3. Same with one tool definition and a forced tool call.
4. A two-turn tool loop: model calls the tool, receives the result, answers.
5. A real OpenDuet turn through the built-in Bot.

### 6.2 Decision service

Create a provider-neutral client:

```ts
// openbot/server/src/decision/types.ts
export type DecisionQuestion =
  | { type: "noul"; instructions?: string; true?: string; false?: string }
  | { type: "choice"; instructions?: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions?: string; criteria: string[] };

export type DecisionAnswers = Record<
  string,
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; level: number; probabilities: Record<string, number>; confidence: number }
>;

export type DecisionClient = {
  decide(state: unknown, questions: Record<string, DecisionQuestion>, signal?: AbortSignal): Promise<DecisionAnswers>;
};
```

Adapters:

- **OpenDecider Nano / Laya** — `POST {DECISION_BASE_URL}/v1/systemone`, bearer token optional. Same Jev-compatible request shape.
- **Mercury Decide** — `POST https://api.inceptionlabs.ai/v1/decisions`, `model: "mercury-decide"`, bearer token from `DECISION_API_KEY` or Inception's native `INCEPTION_API_KEY`.
- **Mercury 3 compatibility** — typed questions over `/v1/chat/completions`; uses `OPENAI_API_KEY` when `DECISION_API_KEY` is unset. This remains available when a deployment has no decision endpoint.

Configuration:

```env
DECISION_PROVIDER=mercury-decide
DECISION_BASE_URL=https://api.inceptionlabs.ai/v1
DECISION_MODEL=mercury-decide
DECISION_API_KEY=               # or INCEPTION_API_KEY
DECISION_TIMEOUT_MS=8000
DECISION_TOOL_THRESHOLD=0.35
DECISION_SAFETY_THRESHOLD=0.5
DECISION_ROUTING_THRESHOLD=0.6
DECISION_TRIAGE_THRESHOLD=0.7
```

**Files**

- `openbot/server/src/decision/types.ts`
- `openbot/server/src/decision/client.ts`
- `openbot/server/src/decision/config.ts`
- `openbot/server/tests/decision-client.test.ts`
- `openbot/server/tests/decision-fallback.test.ts`

**Exit criteria**

- Local server and Mercury Decide both answer the same typed questions.
- Timeout, 5xx, malformed response, and bearer failure all have explicit fallback behavior.
- No decision key is ever sent to the browser.

---

## 7. Phase 2 — local durable threads

### 7.1 How the runtime's synchronous thread endpoints are satisfied

The runtime's SSE fallback (`InMemoryAgentRunner`) is a **local-development** fallback. Its thread methods are synchronous and in-memory. A Postgres query cannot answer them, and the fallback is not user-scoped.

The implemented `PostgresAgentRunner` therefore keeps a **cache** that implements the synchronous `LocalThreadEndpointRunner` contract for the runtime's existing `/threads` routes, while Postgres remains the source of truth. The cache is hydrated once at boot and updated after every run. `run` writes the run, lock and events to Postgres; `connect` replays the hydrated event log and subscribes to the live subject; `isRunning` checks both the live map and the database lease; `stop` aborts the live run in this process.

This is the single-process local shape. A multi-user or multi-replica deployment replaces the synchronous cache with custom async thread routes and `LISTEN/NOTIFY`; the schema and `run`/`connect`/`isRunning` half stay the same.
- Do not expose the runtime’s global `threads/clear`.

### 7.2 Database schema

New Drizzle schema: `openbot/server/src/db/schema/local-threads.ts`

```sql
create table agent_threads (
  id uuid primary key,
  user_id text not null,
  agent_id text not null,
  title text,
  archived boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agent_thread_runs (
  id uuid primary key,
  thread_id uuid not null references agent_threads(id) on delete cascade,
  run_id text not null unique,
  parent_run_id text,
  agent_id text not null,
  status text not null,              -- running | finished | failed | stopped
  events jsonb not null default '[]'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table agent_thread_messages (
  thread_id uuid not null references agent_threads(id) on delete cascade,
  id text not null,
  run_id text,
  role text not null,
  content jsonb not null,
  tool_call_id text,
  created_at timestamptz not null default now(),
  primary key (thread_id, id)
);

create table agent_thread_events (
  thread_id uuid not null references agent_threads(id) on delete cascade,
  run_id text not null,
  seq bigint not null,
  type text not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (thread_id, run_id, seq)
);

create table agent_thread_locks (
  thread_id uuid primary key references agent_threads(id) on delete cascade,
  run_id text not null,
  owner text not null,
  expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now()
);
```

Indexes:

- `agent_threads (user_id, agent_id, updated_at desc)`
- `agent_thread_runs (thread_id, started_at desc)`
- `agent_thread_events (thread_id, run_id, seq)`
- `agent_thread_locks (expires_at)`

### 7.3 `PostgresAgentRunner`

Implemented in `openbot/server/src/threads/postgres-runner.ts`.

```ts
class PostgresAgentRunner extends AgentRunner {
  run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent>;
  stop(request: AgentRunnerStopRequest): Promise<boolean>;
  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean>;
}
```

Implemented behavior:

- Acquire the thread lease with `insert ... on conflict ... where expires_at <= now() or run_id = excluded.run_id`. The second clause lets the handoff lock and the runner share the same run id without a false conflict.
- Reject a second concurrent run on the same thread.
- Insert a `running` run row.
- Run the agent and stream events.
- Append every AG-UI event to `agent_thread_events` through a per-run write chain; a failed write marks the run failed.
- On finalize, replace the thread's message snapshot with `agent.messages`, store the last state snapshot, and write `finished` / `failed` / `stopped`.
- Release the lock in the finalize transaction and heartbeat it while the run is active.
- On `connect`, replay compacted persisted events; if the run is still active in this process, subscribe to its `ReplaySubject`.
- On startup, mark every `running` run as failed and delete every lock. This is correct for the supported single-process local shape; the lease TTL is the recovery story if a second process is ever allowed.

Event bus:

- Single-node local: in-process `ReplaySubject` per thread, implemented.
- Multi-node: Postgres `LISTEN/NOTIFY` or Redis. Not implemented; the cache and live map are process-local.

### 7.4 Thread HTTP routes

The runtime's own synchronous `/api/copilotkit/threads/*` routes are what the app calls today, backed by the `PostgresAgentRunner` cache. They are the single-user local shape.

These async, ownership-scoped routes are the next step for multi-user or multi-replica deployments:

- `GET /api/copilotkit/threads?agentId=...` — list the signed-in person’s threads.
- `GET /api/copilotkit/threads/:threadId/messages` — latest message snapshot.
- `GET /api/copilotkit/threads/:threadId/events` — compacted events.
- `GET /api/copilotkit/threads/:threadId/state` — derived state.
- `PATCH /api/copilotkit/threads/:threadId` — rename/archive.
- `DELETE /api/copilotkit/threads/:threadId` — soft-delete.
- `POST /api/copilotkit/threads/:threadId/subscribe` — optional live updates.

`GET /api/threads/:id` now answers from Postgres in local mode, so the browser can verify a remembered thread without Intelligence.

Every route resolves the actor from the session and checks `agent_threads.user_id`. A thread id is not authorization.

### 7.5 Ownership and security

- The runtime’s `/agent/:id/run` and `/connect` do not know the user in SSE mode. Add a `beforeRequestMiddleware` that:
  - resolves the signed-in actor,
  - reads `threadId` and `agentId` from the body/query,
  - verifies the thread belongs to that actor,
  - rejects unknown or foreign threads.
- `/threads` listing must be user-scoped.
- `/threads/clear` must be per-user or not exposed.
- Do not mount the runtime’s global thread endpoints; intercept first.

### 7.6 History and attachments

- Seed history through the existing `sanitizeSeededHistory`.
- Preserve tool calls, tool results, and interrupt/resume entries.
- Attachments continue to use the existing attachment store; message content keeps attachment ids.
- Do not store attachment bytes in the thread events.

**Exit criteria**

- Run → restart server → reconnect → full transcript restored.
- Two concurrent runs on one thread: one wins, one receives a clear busy error.
- A run killed mid-stream is marked failed and its lock expires.
- User A cannot read, list, run in, or connect to user B’s thread.
- A 500-message thread restores in under the UI deadline (measure; paginate if needed).

---

## 8. Phase 3 — runtime cutover

### 8.1 `copilot.ts`

- Replace `CopilotRuntime` + `CopilotKitIntelligence` with `CopilotSseRuntime` + `PostgresAgentRunner`.
- Remove:
  - `CopilotKitIntelligence`
  - `IntelligenceKnowingANewThread`
  - `createIntelligenceThreadLock`
  - `getRuntimeEntitlements`
  - learning runtimes
  - `identifyUser` (SSE mode does not take it)
- Keep:
  - `BuiltInAgentWithSaneHistory`
  - `CloningRemoteAgent`
  - `RunBuiltAgent`
  - `HeadlessToolsMiddleware`
  - `PersonalMemoryMiddleware`
  - `RemoteLearnedSkillsMiddleware` only if learning is kept; otherwise remove
- Add the local thread ownership middleware.
- Keep telemetry disabled by config.

### 8.2 `index.ts`

Remove:

- `createIntelligenceClient`
- `createIntelligenceMemory`
- `IntelligenceAgentRunner`
- `routineIntelligence`
- `selfHostBannerIntelligence`
- learning auto-assign and learning probe
- Intelligence entitlement calls

Replace:

- `createMemoryStore(database)` — no Intelligence option.
- `routineAgentRunner` — `PostgresAgentRunner`.
- `routineRunner` — local headless turn using the local runner.
- `chooseSkills` — decision-backed or Mercury 3, behind a flag.
- `intentRouter` — decision-backed or Mercury 3, behind a flag.

### 8.3 Other server files

| File | Change |
| --- | --- |
| `server/src/channels/thread-status.ts` | Query local `agent_threads`; no Intelligence `getThread` |
| `server/src/channels/summary.ts` | Read local messages |
| `server/src/openduet/task-report.ts` | Read local messages |
| `server/src/approvals/wiring.ts` | Read local messages |
| `server/src/agents/handoff-wiring.ts` | Use `PostgresAgentRunner`, not `IntelligenceAgentRunner` |
| `server/src/responsibilities/wiring.ts` | Remove Intelligence history dependency |
| `server/src/learning/*` | Remove or hide behind a disabled feature flag |
| `server/src/self-host-banner.ts` | Remove entitlement call; hide the banner in local mode |
| `server/src/intelligence-client.ts` | Delete after cutover |
| `toolkit/src/copilotkit/thread-lock.ts` | Delete; replace with local lock |
| `toolkit/src/run-turn.ts` | Use `PostgresAgentRunner`; remove gateway/thread-lock calls |
| `toolkit/src/copilotkit/agents.ts` | Remove `IntelligenceKnowingANewThread`; keep the rest |

### 8.4 Scripts and configuration

- `openbot/scripts/start.sh`: remove the `licenseStatus` check; replace with a local health check.
- `.env.example`: remove `INTELLIGENCE_*` and `COPILOTKIT_LICENSE_TOKEN`; add local mode and decision settings.
- `docs/telemetry.md`: remove Intelligence sign-up; state that only model-provider traffic remains.
- `README.md`: update quick start; no `copilotkit login`, no `project select`.
- `openbot/docs/architecture.md`: replace Intelligence with local Postgres thread store.
- `openbot/docs/configuration.md`: remove Intelligence requirements.

**Exit criteria**

- Server boots with no Intelligence variables.
- `start.sh` never checks a licence.
- `bun test` passes for local mode.
- No `CopilotKitIntelligence` import remains in server or toolkit.
- A complete chat, approval, routine, handoff, and memory flow works.

---

## 9. Phase 4 — decision model for tool selection

### 9.1 What it decides

The decision model chooses **which skills’ tools are offered** to Mercury 3 for one run. It does not choose the exact tool call and does not execute anything.

The existing `selectTools` already has the right safety property:

- under the floor → offer everything;
- nothing declared → offer everything;
- selector fails → offer everything;
- nothing chosen → offer everything;
- a chosen skill’s tools are intersected with the grant;
- tools no skill claims always ride along.

Keep all of that. Replace only the `choose` callback.

### 9.2 Decision questions

For each granted skill:

```ts
{
  [`skill:${skill.slug}`]: {
    type: "noul",
    instructions: `Does this message need the capability "${skill.title}"? ${skill.summary}`,
  }
}
```

State:

```ts
{
  message: latestUserText(messages),
  // optional: recent context, never the whole transcript
}
```

Selection rule:

- Choose a skill when `P(yes) >= DECISION_TOOL_THRESHOLD`.
- Default threshold **0.35**, biased toward inclusion.
- If no skill reaches the threshold → return `null` → offer everything.
- If the decision service fails or times out → return `null` → offer everything.
- If the catalog has more than, say, 100 skills, split into batches or fall back to everything.

### 9.3 Refactor

`selectTools` currently passes only a text prompt to `choose`. Change it to pass structured input:

```ts
choose: (input: {
  text: string;
  skills: readonly SelectableSkill[];
  prompt: string;
}) => Promise<string | null>;
```

Keep the generative implementation for Intelligence mode and as a fallback. Add `selectToolsWithDecision`.

### 9.4 Audit

Record in `mcp.tools_discovered`:

- decision provider and model;
- threshold;
- selected skill slugs;
- per-skill probability;
- selection reason (`under-floor`, `nothing-declared`, `unavailable`, `nothing-chosen`, `selected`).

**Exit criteria**

- Tool-selection eval: no regression in “needed tool was available”.
- Offer size drops versus Mercury 3 selection.
- Decision service down → full toolset, not an empty one.
- Decision model cannot add a tool the Bot was not granted.

---

## 10. Phase 5 — decision model for safety

### 10.1 Where it plugs in

The existing approval pipeline already has the right shape:

- `safetyRequirement(candidate)` — deterministic keyword floor;
- `strictestRule` — team/personal rules;
- `reviewAction` — model reviewer;
- `decideAction` — composes them, safety first.

Replace only the reviewer’s model implementation with a decision-backed one. Do not remove the deterministic layers.

### 10.2 Questions

State: the same `<request>` and `<action>` content used today.

```ts
{
  verdict: {
    type: "choice",
    instructions: "May this action proceed without asking the person?",
    criteria: {
      proceed: "Clearly within the request and cannot surprise the person.",
      needs_approval: "Beyond the request, affects an account, shares externally, is hard to undo, or uncertain.",
      hand_off: "The person must do it themselves: credentials, security settings, payments, legal commitments.",
    },
  },
  pre_approved: {
    type: "noul",
    instructions: "Did the request explicitly ask for this exact action on this exact target?",
  },
  safety: {
    type: "choice",
    instructions: "Which built-in safety category does this action touch?",
    criteria: {
      none: "None of the categories below.",
      credentials: "A password, passcode, two-factor setting, or other credential.",
      security_settings: "Security, sharing, or access settings.",
      payments: "Pays, purchases, or moves money.",
    },
  },
  beyond_request: { type: "noul", instructions: "Does the action go beyond what the person asked for?" },
  external_share: { type: "noul", instructions: "Does the action send information to someone new or outside the account?" },
  irreversible: { type: "noul", instructions: "Is the action hard or impossible to undo?" },
}
```

### 10.3 Mapping and invariants

- `safety != none` with confidence above threshold → **hand_off**.
- `verdict == hand_off` → **hand_off**.
- `verdict == needs_approval` → **needs_approval**.
- `verdict == proceed` but any of `beyond_request`, `external_share`, or `irreversible` above threshold → **needs_approval**.
- `pre_approved` below a high threshold (e.g. 0.8) → **needs_approval**.
- Decision service error, timeout, malformed answer, or low confidence → **needs_approval** (fail closed).
- The decision model never returns `proceed` when the deterministic policy or a matched deny/hand-off rule already blocked the action.
- The reviewer safety category can only add a hand-off; it never removes the keyword result.

Add an optional gateway preflight for `effect !== "read"`:

- Run the same safety questions with a short timeout.
- If high risk or uncertain → require approval even when `autoReview` is off.
- If the service is down → require approval for writes (fail closed).
- Make this `DECISION_SAFETY_ALWAYS=true` so it can be disabled during rollout.

### 10.4 Reason text

The decision model returns probabilities, not prose. Options:

- Template from the chosen safety category and verdict (fast, deterministic).
- Call Mercury 3 only when the action is high-risk and a human-readable reason adds value.

Recommended: template for the audit row and approval card; Mercury 3 only for the final explanation if needed.

### 10.5 Safety eval

Create `evals/safety` with labelled actions:

- reads;
- benign writes;
- payments;
- credential changes;
- security/sharing changes;
- external sends;
- destructive actions;
- prompt-injection attempts in the tool result.

Measure:

- **unsafe allowed** (must be zero);
- approval rate;
- false-positive approval rate;
- latency;
- behavior when the decision service is down.

**Exit criteria**

- No unsafe action is auto-approved in the eval.
- Decision service failure always results in approval for writes.
- Existing approval tests pass.
- The decision model cannot widen grants or bypass policy.

---

## 11. Phase 6 — routing and triage (implemented)

### Routing

- `routing/classify.ts` now takes an optional typed decision dependency; `decision/routing.ts` asks a `choice` over the roster.
- `state` = message + roster role descriptions + reachable systems.
- `choice` = agent id; `confidence` = the chosen option’s probability.
- Below `DECISION_ROUTING_THRESHOLD` → existing default coworker fallback, recorded as `unconfident`.
- Off-roster, malformed, unreachable, or absent answers → existing default; the router never throws.
- Reason = `the decision model matched <coworker>`; the audit trail keeps the fallback kind in `undecided`.
- Live check: “move my 3pm meeting to Thursday afternoon” chose the calendar coworker at 0.95 confidence.

### Triage

- `openduet/triage.ts` asks a typed `noul`: “does this message need this person to personally decide, reply, approve, pay, sign or act soon?”
- `decision/triage.ts` compares the chosen outcome’s probability with `DECISION_TRIAGE_THRESHOLD`. Below it, the message is unsorted; it is never silently marked “can wait.”
- Deterministic rules still decide the obvious mail first; the decision model only sees what they leave.
- Reason = a deterministic template. The model returns probabilities, not prose.
- Live check: an invoice approval request returned `needs_you` and was recorded as `decision:mercury-3`.
- Still required before switching providers: run `evals/triage` against Mercury 3, OpenDecider, Laya, and Mercury Decide. A small model must not silently mark high-stakes mail as “can wait.”

---

## 12. Phase 7 — optional: no CopilotKit packages at all

Only if Target A is not enough.

Replace:

- `CopilotSseRuntime` → custom AG-UI server:
  - `POST /agent/:id/run` — SSE stream;
  - `POST /agent/:id/connect` — replay/live stream;
  - `POST /agent/:id/stop`;
  - thread routes.
- `@copilotkit/react-core` → custom React chat:
  - message list;
  - composer and attachments;
  - tool renderers;
  - approval cards;
  - interrupts/resume;
  - A2UI/generative UI;
  - thread list and history.
- `BuiltInAgent` → your own model loop (Vercel AI SDK, LangGraph, Mastra, or direct OpenAI-compatible calls).
- `useFrontendTool`, `useHumanInTheLoop`, `useRenderTool` → your own tool registry and renderer.
- CopilotKit runtime middleware → your own middleware for memory, attachments, selection, and approvals.

Keep:

- OpenBot’s auth, roles, channels, policy, audit, approvals, computers, supervisor, connectors, routines, and database.
- AG-UI as the wire protocol.
- `@ag-ui/core` and `@ag-ui/client`.

Estimate: 4–8 weeks for a minimal parity cut; longer for all channels, interrupts, attachments, A2UI, and mobile.

**Recommendation:** do not do Phase 7 unless you specifically need zero CopilotKit npm packages. Target A removes the subscription and all cloud calls, which is the actual goal.

---

## 13. Configuration summary

```env
# Local mode. Durable threads are always Postgres in this mode; there is no store flag.
OPENBOT_LOCAL_MODE=true
DATABASE_URL=postgres://openbot@127.0.0.1:5433/openduet_local

# Main model: Mercury 3
OPENAI_BASE_URL=https://api.inceptionlabs.ai/v1
OPENAI_API_KEY=...
BOT_PROVIDER=openai
BOT_MODEL=mercury-3
AGENT_BOT_MODEL=mercury-3

# Decision model. The local default: in this process, on the in-repo weights, no extra service.
DECISION_PROVIDER=opendecider        # opendecider | laya (local) | mercury-decide | mercury-3 (hosted)
DECISION_MODEL=opendecider-nano
DECISION_BASE_URL=in-process         # an http(s) URL instead calls a Laya/OpenDecider server
# Hosted alternative, Inception's typed-decision endpoint:
# DECISION_PROVIDER=mercury-decide
# DECISION_BASE_URL=https://api.inceptionlabs.ai/v1
# DECISION_MODEL=mercury-decide
# DECISION_API_KEY=                  # or INCEPTION_API_KEY
DECISION_TIMEOUT_MS=8000
DECISION_TOOL_THRESHOLD=0.35
DECISION_SAFETY_THRESHOLD=0.5
DECISION_ROUTING_THRESHOLD=0.6
DECISION_TRIAGE_THRESHOLD=0.7
# Planned, not read today: run safety review even when automatic review is off.
# DECISION_SAFETY_ALWAYS=true

# No CopilotKit Intelligence
# INTELLIGENCE_API_URL=
# INTELLIGENCE_GATEWAY_WS_URL=
# INTELLIGENCE_API_KEY=
# COPILOTKIT_LICENSE_TOKEN=

# No CopilotKit telemetry
COPILOTKIT_TELEMETRY_DISABLED=true
DO_NOT_TRACK=1
```

---

## 14. Testing and evals

### Unit

- Decision client request/response for each provider.
- Decision fallbacks: timeout, 5xx, malformed, unauthorized.
- Tool selection: threshold, empty selection, failure, grant intersection.
- Safety mapping: every combination of verdict/safety/risk questions.
- Thread store: ownership, locking, pagination, deletion.

### Integration

Implemented and covered:

- Run → persist → restart → reconnect (messages, events, state, run status), including message order across multiple turns.
- Concurrent run rejection.
- Stop mid-run and lock release.
- Failed run persistence without erasing the previous message snapshot.
- Orphaned `running` run recovery and stale-lock clearing at boot.
- Routine headless turn through the worker and the server's durable runner.
- Bot-to-bot handoff using `copilotRuntime.runner`, `copilotRuntime.history` and the durable thread lock.
- Group-chat turns using the same `routineIntelligence` + `routineAgentRunner` pair.
- Decision routing and triage, including low-confidence/off-roster/failure fallbacks.

Still to add:

- Multi-user isolation for the runtime's synchronous thread list.
- Approval resume after restart.
- Attachments across restart.
- Memory local-only.
- No Intelligence variables anywhere (the build still carries the Intelligence mode).

### Evals

- `evals/triage` — existing 62 labelled emails. Compare Mercury 3, OpenDecider, Laya, Mercury Decide.
- `evals/tool-selection` — new: messages with expected skills; measure recall of needed tools and offer size.
- `evals/safety` — new: labelled actions; measure unsafe-allowed, approval rate, false positives.
- `evals/routing` — new: messages + roster; measure top-1 accuracy and fallback rate.

### Performance

- Decision latency p50/p95/p99.
- Thread restore time for 10, 100, 500 messages.
- Concurrent runs per instance.
- Event persistence throughput.

---

## 15. Rollout and rollback

1. **Branch:** implement local mode behind `OPENBOT_LOCAL_MODE=true`.
2. **Dual mode:** keep Intelligence mode working; run both test suites.
3. **Dogfood:** single-user local install, no Intelligence keys.
4. **Compare:** run triage, tool-selection, and safety evals against both modes.
5. **Default:** switch the default to local mode in `.env.example`.
6. **Remove:** delete Intelligence code only after one release of local mode.
7. **Rollback:** set `OPENBOT_LOCAL_MODE=false` and restore Intelligence keys; the database keeps both schemas during the transition.

Do not delete Intelligence code in the same commit that first introduces local mode. Keep the rollback path.

---

## 16. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Local thread endpoints are dev-grade | Data loss or security holes | Custom async Postgres routes; ownership middleware; tests |
| Runtime `AgentRunner` contract changes | Upgrade breakage | Pin `@copilotkit/runtime`; integration tests; adapter layer |
| Event persistence race | Missing messages on reconnect | Persist before emitting; finalize in `finally`; replay from DB |
| Tool selection under-selects | Bot lacks a needed tool | Low threshold; empty/failure → offer everything; eval |
| Safety model false negative | Unsafe action auto-approved | Deterministic policy first; decision model can only escalate; fail closed |
| Decision service latency | Slow turns | 2s timeout; cache where safe; fallback |
| Mercury 3 compatibility | Tool calls or streaming fail | Smoke test; adapter/proxy if needed |
| Learning removed | Lost capability | Accept; optional later local learning project |
| Multi-replica realtime | Connect sees stale state | Postgres LISTEN/NOTIFY or Redis; single-node first |
| Approval/attachments across restart | Broken resume | Persist run state and attachment refs; integration tests |

---

## 17. Rough estimates

| Phase | Estimate |
| --- | --- |
| 0–1: flags, Mercury 3, decision client | 2–3 days |
| 2–3: Postgres threads, runner, cutover | 2–3 weeks |
| 4–5: tool selection + safety decision model | 2–3 weeks |
| 6: routing + triage | 1–2 weeks |
| 7: full no-CopilotKit rewrite (optional) | 4–8 weeks |

Target A, production-quality: roughly **5–8 weeks** for one experienced engineer, including tests and evals. A single-user proof of concept is much faster: **1–2 weeks**.

These are estimates, not commitments. The thread runner and the approval/resume edge cases are the schedule risks.

---

## 18. Open questions

1. **Target A or B?** Remove the subscription only, or also remove the MIT CopilotKit packages?
2. **Decision provider:** OpenDecider Nano, Laya, or Mercury Decide? Or support all three behind the adapter?
3. **Single-user or multi-user?** Multi-user adds ownership, isolation, and pagination requirements.
4. **Which features must survive the first cut?** Routines, handoffs, group chats, voice, learning, mobile?
5. **Multi-replica?** If yes, the event bus needs Postgres LISTEN/NOTIFY or Redis.
6. **Data policy:** is it acceptable for Mercury 3 to see the conversation content? If not, the main model must be local too.
7. **Learning:** drop it, or plan a local replacement later?
8. **Mercury Decide key:** separate `DECISION_API_KEY`, never `OPENAI_API_KEY`.

---

## 19. Definition of done

- `OPENBOT_LOCAL_MODE=true` boots with no `INTELLIGENCE_*` variables.
- No CopilotKit account, CLI, licence, or telemetry is required.
- Threads, messages, events, state, memory, approvals, and audit survive restart.
- Mercury 3 handles a real tool-using turn.
- The decision model narrows tools and classifies safety.
- Tool selection failure offers everything; safety failure requires approval.
- User A cannot access user B’s threads.
- Triage, tool-selection, and safety evals meet their thresholds.
- `start.sh` does not check a licence.
- A UI turn selects a tool, the computer executes it, and the result returns to the conversation. Verified 2026-10-29: `computer_navigate` opened a Wikipedia page and the answer quoted it.
- The rollback path to Intelligence mode is documented and tested.
