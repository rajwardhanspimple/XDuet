# Zero-Telemetry & Privacy in XDuet

XDuet is built from the ground up to be a sovereign, local-first system. All third-party telemetry, remote event tracking, and cloud analytics have been completely disabled.

## 1. No External Telemetry

- **Zero Cloud Tracking**: XDuet sends no usage events, session heartbeats, or telemetry beacons to external servers.
- **Disabled Ingestion**: All telemetry ingestion URLs have been suppressed and null-routed (`enabled: false`).
- **Audit Logs Stay Local**: Event logging and execution audits are saved strictly in your local PostgreSQL database under your direct ownership.

## 2. No Mandatory Cloud Intelligence

Unlike legacy systems that required external cloud subscriptions for conversation persistence:
- **Durable Threads**: Managed entirely by XDuet's native PostgreSQL agent runner.
- **Local Memory & Knowledge**: Embeddings and memory vectors persist locally in `pgvector`.
- **Zero Remote Entitlement Checks**: No licensing servers or paywall banners are contacted during startup or runtime.

## 3. Policy & Data Protection

- **Masked Input**: Passwords and authentication secrets entered during browser actions bypass the agent's LLM context and are piped directly into form fields.
- **Egress Guardrails**: Outgoing messages and requests are checked to prevent accidental leakage of sensitive environment variables or credentials.
