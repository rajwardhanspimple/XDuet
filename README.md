<div align="center">

# XDuet

### An autonomous, sovereign proactive AI agent that gets your work done locally and keeps you in the loop

[Quick start](#quick-start) · [Overview](#overview) · [Features and Capabilities](#features-and-capabilities) · [Architecture](#how-it-works) · [Contributing](#contributing)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Status: active development](https://img.shields.io/badge/status-active%20development-green.svg)
![Mode: 100% Local Sovereign](https://img.shields.io/badge/runtime-100%25%20local%20sovereign-success.svg)

**Each agent has a computer of its own. Use it on the web, on mobile, in Slack, or in Microsoft Teams.**

Run XDuet completely self-hosted with your own local models and databases. Zero cloud lock-in, zero external telemetry, and zero mandatory cloud subscriptions. Everything stays under your control.

</div>

---

## Overview

**XDuet** does not wait to be asked. It starts your day with a short morning brief, keeps working on an isolated computer of its own while you step away, and comes back only when something genuinely needs your decision. Before it sends an email, makes a payment, signs a document, or deletes anything, it shows you the exact action and waits for your explicit approval.

Unlike cloud-dependent assistants, XDuet is built on a **100% sovereign, local-first runtime**:
- **Zero Cloud Runtime Lock-In**: Replaced vendor cloud dependencies with a native AG-UI Server-Sent Events (SSE) router.
- **Local Neural Deciders**: In-repo trained decision engines (**Mercury-3**, **OpenDecider Nano**, and **Laya**) provide deterministic tool selection, policy safety checks, and email triage without cloud latency.
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
| **Neural Local Deciders** | Instant local classification and triage using calibrated in-repo weights (OpenDecider & Laya). |
| **Gmail & Google Calendar** | Seamless local integration to review inboxes, prepare draft responses, and summarize schedules. |
| **Governed Connectors (MCP)** | Extensible Model Context Protocol connectors for Google Drive, Notion, and workspace tools. |
| **Automated Routines** | Run recurring background jobs and proactive workflows on customizable schedules. |
| **Generative Make UI** | Generate interactive dashboards, documents, mockups, and UI widgets on the fly. |
| **Voice Interaction** | Speak your requests directly via integrated speech recognition and transcription. |

---

## Quick Start

### Prerequisites
- [Bun](https://bun.sh) 1.2+ or Node.js
- [PostgreSQL](https://www.postgresql.org/) (local or Docker) with `pgvector`
- Model API key (OpenAI, Anthropic, or an OpenAI-compatible local LLM endpoint such as Ollama or vLLM)

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/rajwardhanspimple/XDuet.git
   cd XDuet
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Set your model provider and key in `.env`:
   ```env
   BOT_MODEL=mercury-3
   OPENAI_API_KEY=your_key_here
   # Or use Anthropic / Local vLLM / Ollama:
   # BOT_PROVIDER=anthropic
   # ANTHROPIC_API_KEY=your_key_here
   ```

3. **Install dependencies:**
   ```bash
   bun install
   ```

4. **Launch the local stack:**
   ```bash
   bun scripts/local-stack.ts up
   ```
   * Or run via Docker Compose / Shell:
   ```bash
   bash scripts/start.sh
   ```

5. **Open the app:**
   Navigate to [http://localhost:3010](http://localhost:3010) (or `http://localhost:3110` in local-stack mode) in your browser.

---

## How It Works

```text
User Interface (Web · Desktop · Slack · Teams)
       │                                       ▲
       │ Prompts & Approvals                   │ Morning Briefs & Status
       ▼                                       │
XDuet Native Server (Hono + Native AG-UI SSE Router)
  ├── Local Deciders      (OpenDecider Nano / Laya / Mercury-3)
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
2. **Local Decision Layer:** Uses trained in-repo neural decision weights to instantly classify input urgency and tool safety without expensive cloud round-trips.
3. **Isolated Computer:** Agents work inside dedicated containerized sandboxes with their own browser profiles and storage, ensuring safe automated execution.
4. **Human-in-the-Loop:** Actions that write to external systems or affect real data must pass through policy verification and explicit user consent.

---

## License

This project is licensed under the [MIT License](./LICENSE).
