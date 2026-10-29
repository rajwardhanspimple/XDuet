<div align="center">

# XDuet

### An autonomous, sovereign proactive AI agent that gets your work done locally and keeps you in the loop

[Quick start](#quick-start) · [Overview](#overview) · [Features and Capabilities](#features-and-capabilities) · [Architecture](#how-it-works) · [Contributing](#contributing)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Status: active development](https://img.shields.io/badge/status-active%20development-green.svg)
![Mode: Local-first](https://img.shields.io/badge/runtime-local--first-blue.svg)

**Each agent has a computer of its own. Use it on the web, on mobile, in Slack, or in Microsoft Teams.**

Run XDuet self-hosted. The platform, threads, memory, credentials and audit log live on your machine, in your own PostgreSQL. Only model calls leave it, and only to the OpenAI-compatible endpoint you configure. No CopilotKit subscription, no Intelligence project, no external telemetry.

</div>

---

## Overview

**XDuet** does not wait to be asked. It starts your day with a short morning brief, keeps working on an isolated computer of its own while you step away, and comes back only when something genuinely needs your decision. Before it sends an email, makes a payment, signs a document, or deletes anything, it shows you the exact action and waits for your explicit approval.

Unlike cloud-dependent assistants, XDuet is built on a **local-first runtime**, with model APIs as the only external call:
- **No Cloud Runtime Lock-In**: Replaced the vendor's hosted thread service with a native AG-UI Server-Sent Events (SSE) router and a PostgreSQL-backed runner. The MIT runtime is kept; the subscription is not.
- **Split Model Roles**: **Mercury 3** handles chat, tool calls and writing through an external OpenAI-compatible API. A separate **decision model** handles tool selection, safety review, routing and triage — **OpenDecider Nano** in-process by default, so those decisions cost no network round-trip; **Laya** or **Mercury Decide** are the alternatives.
- **Private Durable Threads & Memory**: All conversations, long-term memory, credentials, and audit logs are stored securely in your own local PostgreSQL database.
- **Zero Telemetry**: No third-party usage tracking, event ingestion, or telemetry beacons.

## What It Does

- **Morning Brief.** One concise message to start the day: what is on your schedule, what changed overnight, and what requires a decision from you.
- **Proactive Triage.** Scans incoming emails, calendar events, and messages to bring urgent items to your attention while filtering out the noise.
- **Isolated Computer Per Agent.** Hand off a task and your agent executes in a sandboxed environment: a dedicated Chromium browser profile, local workspace files, and governed shell access.
- **Approval Boundary.** Every external action (sending mail, modifying files, executing code) is paused for your decision: **Allow once**, **Always allow**, or **Refuse**.
- **Masked Secrets.** Passwords and credentials entered during web tasks bypass the agent transcript and are piped directly to the target service.
- **Data Privacy & Redaction.** Outgoing communication is automatically inspected to prevent accidental exposure of sensitive keys, tokens, or personal identifiers.

---

## Features and Capabilities

| Capability | What it means for you |
| :--- | :--- |
| **A Computer of Its Own** | Runs uninterrupted in its own browser, `/workspace` volume, and sandboxed shell. |
| **Asks Before It Acts** | Policy guardrails review every modifying action. Sensitive actions require explicit human-in-the-loop approval. |
| **Local Durable Memory** | Conversations, threads, and memory persist in your local PostgreSQL database across restarts. |
| **Local Decision Model** | Tool selection, safety review, routing and triage run in process on in-repo weights by default (OpenDecider Nano); Laya or Mercury Decide are optional. |
| **Gmail & Google Calendar** | Seamless local integration to review inboxes, prepare draft responses, and summarize schedules. |
| **Governed Connectors (MCP)** | Extensible Model Context Protocol connectors for Google Drive, Notion, and workspace tools. |
| **Automated Routines** | Run recurring background jobs and proactive workflows on customizable schedules. |
| **Generative Make UI** | Generate interactive dashboards, documents, mockups, and UI widgets on the fly. |
| **Voice Interaction** | Speak your requests directly via integrated speech recognition and transcription. |

---

## Quick Start

### Prerequisites
- [Bun](https://bun.sh) 1.2+ (the local stack is tested on 1.4.3)
- [PostgreSQL](https://www.postgresql.org/) with `pgvector`, running locally. The local stack does not start Postgres for you.
- Model API key for an OpenAI-compatible endpoint — Mercury 3 at `https://api.inceptionlabs.ai/v1` by default, or any other gateway, vLLM or Ollama endpoint.

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/rajwardhanspimple/XDuet.git
   cd XDuet
   ```

2. **Configure environment:**
   ```bash
   cp openbot/.env.example openbot/.env
   ```
   The template lives in `openbot/`, and the platform reads `openbot/.env`; the root `.env.example` is only a pointer to it. `scripts/start.sh` links a root `.env` to `openbot/.env` if you want to edit it from the repository root.

   The minimum for a local install:
   ```env
   OPENBOT_LOCAL_MODE=true          # runs without CopilotKit Intelligence
   OPENBOT_SINGLE_USER=true
   DATABASE_URL=postgres://openbot@127.0.0.1:5433/openduet_local

   # Main model: chat, tool calls, writing
   BOT_PROVIDER=openai
   OPENAI_BASE_URL=https://api.inceptionlabs.ai/v1
   OPENAI_API_KEY=your_key_here
   BOT_MODEL=mercury-3

   # Decision model: tool selection, safety, routing, triage
   DECISION_PROVIDER=opendecider
   DECISION_MODEL=opendecider-nano
   DECISION_BASE_URL=in-process
   ```
   `DECISION_BASE_URL=in-process` runs the decider on the in-repo weights with no extra service. Point it at a Laya/OpenDecider HTTP server, or use `mercury-decide`, if you prefer. Leaving all `DECISION_*` unset turns decision features off; the deterministic policy and approval rules still run.

3. **Install dependencies:**
   ```bash
   bun install
   ```
   The root `postinstall` installs `openbot/` for you.

4. **Launch the local stack:**
   ```bash
   cd openbot
   bun run local:up
   ```
   `bun run local:status` reports what is up and `bun run local:down` stops it. The stack starts the computer, API server, routines worker and app; Postgres is the only thing you provide.

   * Or use Docker Compose — from the repository root. This path serves different ports and also starts the containerised Bots:
   ```bash
   bash scripts/start.sh
   ```

5. **Open the app:**
   - Local stack: [http://127.0.0.1:3110](http://127.0.0.1:3110) — API on `3101`, computer on `4100`.
   - Docker Compose: [http://localhost:3010](http://localhost:3010) — API on `3001`.

---

## How It Works

```text
User Interface (Web · Desktop · Slack · Teams)
       │                                       ▲
       │ Prompts & Approvals                   │ Morning Briefs & Status
       ▼                                       │
XDuet Native Server (Hono + Native AG-UI SSE Router)
  ├── Main Model          (Mercury 3 over an OpenAI-compatible API)
  ├── Local Deciders      (OpenDecider Nano / Laya / Mercury Decide)
  ├── Triage Engine       (Local email & schedule importance scoring)
  ├── Policy Boundary     (Audit logging · Allow Once · Refuse)
  └── Local Threads       (PostgreSQL runner & durable message store)
       │ AG-UI Protocol
       ▼
Agent Computer Sandbox
  ├── Isolated Chromium   (Automated browser execution)
  ├── Sandboxed Workspace (/workspace filesystem)
  └── Local Tool Gateway  (MCP connectors & system tools)
```

1. **Native AG-UI Server:** Replaces bloated cloud frameworks with a lightweight, high-performance Hono streaming router serving standard Server-Sent Events (SSE).
2. **Local Decision Layer:** Uses trained in-repo neural decision weights to classify tool selection, safety, routing and input urgency without an extra cloud round-trip. Mercury 3, the main model, still chooses and calls the tool; the deciders only decide what it is offered and how risky an action is.
3. **Isolated Computer:** Agents work inside dedicated containerized sandboxes with their own browser profiles and storage, ensuring safe automated execution.
4. **Human-in-the-Loop:** Actions that write to external systems or affect real data must pass through policy verification and explicit user consent.

---

## License

This project is licensed under the [MIT License](./LICENSE).
