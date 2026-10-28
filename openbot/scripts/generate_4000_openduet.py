#!/usr/bin/env python3
"""
generate_4000_openduet.py
Generates exactly 4,000 balanced training samples (1,000 per domain)
for OpenDuet Decider Models (Laya Spec A & OpenDecider SFT Spec B).
Combines real Hugging Face datasets with a deterministic combinatorial
hard-negative synthesizer so you always get 1,000 unique rows per section.
"""

import json
import random
from pathlib import Path
from typing import List, Dict, Any

random.seed(2026)

try:
    from datasets import load_dataset
    HF_AVAILABLE = True
except ImportError:
    HF_AVAILABLE = False
    print("[WARN] `datasets` not installed. Using high-diversity combinatorial generator for all 4,000 rows.")

SYSTEM_PROMPT = (
    "You are OpenDecider, a precise System-1 classification model. "
    "Given a <state> and <questions>, respond strictly with valid JSON "
    "matching the requested answer types (`noul`, `choice`, or `score`)."
)

def spec_a_to_spec_b(record: Dict[str, Any]) -> Dict[str, Any]:
    state_str = json.dumps(record["state"], indent=2, ensure_ascii=False)
    questions_str = json.dumps(record["questions"], indent=2, ensure_ascii=False)
    answers_str = json.dumps(record["answers"], indent=2, ensure_ascii=False)
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"<state>\n{state_str}\n</state>\n\n<questions>\n{questions_str}\n</questions>"},
            {"role": "assistant", "content": answers_str},
        ]
    }

# ==============================================================================
# SECTION 1: EMAIL TRIAGE (1,000 Samples: 500 needs_you=1, 500 needs_you=0)
# ==============================================================================
def build_section_1_triage(target_count: int = 1000) -> List[Dict[str, Any]]:
    half = target_count // 2
    positives, negatives = [], []

    # 1A. Pull from `tunedtensor/email-triage-v1` and `weijianzhg/email-triage-action-seed`
    if HF_AVAILABLE:
        for repo in ["tunedtensor/email-triage-v1", "weijianzhg/email-triage-action-seed"]:
            try:
                ds = load_dataset(repo, split="train")
                for row in ds:
                    subj = str(row.get("subject") or row.get("title") or "").strip()
                    body = str(row.get("body") or row.get("snippet") or row.get("text") or "").strip()
                    sender = str(row.get("sender") or row.get("from") or "contact@enterprise.com").strip()
                    decision = str(row.get("decision") or row.get("action") or row.get("urgency") or "").lower()
                    if not subj or not body:
                        continue
                    is_urgent = any(k in decision for k in ["reply", "escalate", "critical", "high", "urgent", "1", "true"])
                    if is_urgent and len(positives) < half:
                        positives.append((sender, subj, body, {"Auto-Submitted": "no"}))
                    elif not is_urgent and len(negatives) < half:
                        negatives.append((sender, subj, body, {"Auto-Submitted": "auto-generated"}))
            except Exception as e:
                print(f"[INFO] Skipping {repo}: {e}")

    # 1B. Combinatorial synthesizer for remaining slots (guarantees 500 pos + 500 neg)
    urgent_senders = [
        "billing-collections@aws.amazon.com", "docusign@docusign.net", "customs@dhl.com",
        "wire-desk@svb.com", "security@github.com", "payroll@rippling.com", "cto@client-global.io",
        "legal@fenwick.com", "soc-alerts@pagerduty.com", "tax-compliance@deloitte.com",
        "escrow@firstamerican.com", "vp-ops@fortune500-partner.com", "registrar@cloudflare.com"
    ]
    urgent_scenarios = [
        ("URGENT: Payment declined on Invoice #{inv} (${amt})", "Your primary corporate card ending in {card} failed for ${amt}. Service suspension starts at 23:59 UTC today unless settled in the billing portal."),
        ("Action Required Today: Counter-sign {doc} before {hour}:00 PM EST", "Legal counsel uploaded the final execution copy of {doc}. The closing window expires today at {hour}:00 PM EST. Please complete your DocuSign signature immediately."),
        ("SHIPMENT ON HOLD: Waybill #{inv} detained at port of entry", "Customs brokerage requires a signed commercial invoice and importer tax ID before {hour}:00 PM today or the cold-chain pallet will be returned to origin."),
        ("[P0 ESCALATION] Production webhook returning 502/504 for {client}", "We are dropping live checkout transactions on endpoint /v2/charge since {hour}:15 UTC. Can your on-call lead join the incident bridge right now?"),
        ("Callback Verification Required: Outgoing Wire #WR-{inv} (${amt})", "Your international wire transfer of ${amt} is held at the treasury desk. Call ext. {card} before 16:00 EST today to verify voice PIN or the wire cancels."),
        ("[CRITICAL] Leaked API secret detected in public commit #{inv}", "Automated scanning detected an active production token in repository acme-core. Rotate this credential immediately and confirm remediation today."),
        ("Payroll Cutoff in {hour} Hours: Final Admin Sign-Off Needed", "Direct deposit payroll run (${amt}) is locked awaiting your approval before 4:00 PM PST today so employee funds settle on time."),
        ("Domain Expiration Final Notice: acme-prod-{inv}.io expires tonight", "Auto-renew failed for your production DNS zone. Update payment method today to prevent immediate DNS resolution failure across all services.")
    ]

    can_wait_senders = [
        "receipts@stripe.com", "deals@ai-summit-expo.com", "calendar-notification@google.com",
        "newsletter@substack.com", "messages-noreply@linkedin.com", "noreply@status.datadoghq.com",
        "sdr-outreach@growth-agency.io", "notifications@github.com", "no-reply@amazonses.com",
        "marketing@saas-weekly.com", "digest@medium.com", "promo@cloud-discounts.net"
    ]
    can_wait_scenarios = [
        ("Receipt for your subscription #{inv} (${amt}) - No action needed", "Thank you for your business. Your card ending in {card} was automatically charged ${amt}. No action is needed on your part. Attached is your paid receipt."),
        ("URGENT: Final {hour} Hours to Claim 65% Off VIP Conference Passes!", "ACTION REQUIRED TODAY! Don't miss our flash sale for the Global AI Summit. Lock in your discounted ticket before midnight tonight!"),
        ("Accepted: Sprint Planning & Architecture Sync @ {hour}:00am", "teammate-{inv}@acme.io has accepted this calendar invitation. No action needed."),
        ("Quick question about Acme's outbound pipeline today?", "Hi there, I noticed you're scaling your engineering and sales teams. Do you have 15 minutes today to see how we booked {inv} demos last month?"),
        ("Weekly Engineering Digest #{inv}: How Local SLMs Cut Latency", "Read this week's curated technical articles on quantization, KV-cache routing, and PostgreSQL indexing strategies."),
        ("[RESOLVED] Minor metric ingestion delay in region us-east-{hour}", "The brief delay in dashboard metric reporting has been fully resolved. All historical data has backfilled automatically. No customer action is required."),
        ("You appeared in {inv} LinkedIn searches this week", "Recruiters and founders viewed your profile. Upgrade to Premium today for 50% off to see everyone who searched for you."),
        ("Automated Backup Completed Successfully: Snapshot #snap-{inv}", "Nightly RDS snapshot completed in {hour} minutes with zero errors. This is an automated notification; no action is required.")
    ]

    while len(positives) < half:
        sender = random.choice(urgent_senders)
        subj_t, body_t = random.choice(urgent_scenarios)
        params = {
            "inv": random.randint(10000, 99999),
            "amt": f"{random.randint(2, 195)},{random.randint(100, 999)}.00",
            "card": random.randint(1000, 9999),
            "doc": random.choice(["Series B Side Letter", "Enterprise MSA", "HIPAA BAA Addendum", "SOC2 Audit Attestation", "Executive Offer Letter"]),
            "hour": random.randint(2, 6),
            "client": random.choice(["Meridian Health", "Apex Logistics", "Vanguard Retail", "Kestrel FinTech"])
        }
        positives.append((sender, subj_t.format(**params), body_t.format(**params), {"Auto-Submitted": "no"}))

    while len(negatives) < half:
        sender = random.choice(can_wait_senders)
        subj_t, body_t = random.choice(can_wait_scenarios)
        params = {
            "inv": random.randint(100, 9999),
            "amt": f"{random.randint(19, 950)}.00",
            "card": random.randint(1000, 9999),
            "hour": random.randint(1, 9)
        }
        negatives.append((sender, subj_t.format(**params), body_t.format(**params), {"Auto-Submitted": "auto-generated"}))

    records = []
    for i in range(half):
        p_sender, p_subj, p_body, p_hdr = positives[i]
        n_sender, n_subj, n_body, n_hdr = negatives[i]
        records.append({
            "id": f"triage-{len(records)+1:04d}",
            "domain": "triage",
            "state": {"from": p_sender, "to": ["user@acme.io"], "subject": p_subj, "body": p_body, "headers": p_hdr},
            "questions": {"needs_you": {"type": "noul", "instructions": "Does this email require direct action today?"}},
            "answers": {"needs_you": {"type": "noul", "noul": 1}}
        })
        records.append({
            "id": f"triage-{len(records)+1:04d}",
            "domain": "triage",
            "state": {"from": n_sender, "to": ["user@acme.io"], "subject": n_subj, "body": n_body, "headers": n_hdr},
            "questions": {"needs_you": {"type": "noul", "instructions": "Does this email require direct action today?"}},
            "answers": {"needs_you": {"type": "noul", "noul": 0}}
        })
    return records[:target_count]


# ==============================================================================
# SECTION 2: TOOL & SKILL SELECTION (1,000 Samples across 8 skills, 50/50 noul)
# ==============================================================================
def build_section_2_skills(target_count: int = 1000) -> List[Dict[str, Any]]:
    skills = ["weather", "calendar", "email", "github", "shell", "computer", "database", "memory"]

    positive_templates = {
        "weather": [
            "Check the hourly rain radar, UV index, and wind speed in {city} before my {hour} PM outdoor run.",
            "Will there be snow or freezing rain in {city} tomorrow morning around {hour} AM?",
            "Get the 7-day barometric pressure and humidity forecast for {city}.",
            "What is the current air quality index (AQI) and temperature in {city} right now?"
        ],
        "calendar": [
            "Find a {mins}-minute free slot on {day} between me and {person}@acme.io and schedule a {topic} sync.",
            "Move my {hour} PM meeting with {person}@acme.io on {day} to the following day at the same time.",
            "Check my calendar on {day} and list all conflicting invites between 9 AM and 5 PM.",
            "Block out {mins} minutes of focus time on {day} afternoon titled '{topic} Deep Work'."
        ],
        "email": [
            "Search my inbox for unread messages from {person}@acme.io about '{topic}' and draft a concise reply.",
            "Send an email to {person}@acme.io with the subject '{topic} Update' attaching the latest summary.",
            "Forward the latest billing thread from {person}@vendor.com to finance@acme.io with a note to review.",
            "Filter my inbox for threads containing attachment PDFs received in the last {mins} hours."
        ],
        "github": [
            "List all open pull requests in repo acme/{repo} labeled '{label}' and check if CI status checks passed.",
            "Open a new GitHub issue in acme/{repo} titled 'Fix {topic} regression' and assign it to @{person}.",
            "Compare the diff between branch feat/{repo}-{mins} and main in acme/{repo}.",
            "Fetch the review comments on PR #{mins} in acme/{repo} and check if approval is still pending."
        ],
        "shell": [
            "Run lsof -i :{port} in the terminal and terminate the hanging process holding that port.",
            "Execute a bash one-liner to find all .log files larger than {mins}MB under /var/log/{repo} and gzip them.",
            "Check current disk inode usage with df -i and list the top 5 largest directories in /opt/{repo}.",
            "Run systemctl status {repo}.service and tail the last {mins} lines of journalctl output."
        ],
        "computer": [
            "Open the legacy vendor portal in Chromium, click the '{topic}' button in the top navbar, and take a screenshot.",
            "Navigate the browser to https://internal.{repo}.local:{port}, fill the search box, and click 'Export CSV'.",
            "Scroll to the bottom of the active browser tab, click the pagination 'Next' button, and capture a DOM snapshot.",
            "Click the modal confirmation checkbox on the screen and drag the uploaded file into the dropzone."
        ],
        "database": [
            "Run a read-only SQL query on the {repo}_prod Postgres database to count active rows grouped by {label}.",
            "Inspect the index definitions and foreign keys on table public.{repo}_events in PostgreSQL.",
            "Execute EXPLAIN ANALYZE on the slow reporting SELECT query joining users and {repo}_invoices.",
            "Query the Postgres information_schema to list all columns of type jsonb in the {repo} schema."
        ],
        "memory": [
            "Remember that my preferred {topic} format is concise bullet points and store that in my user profile.",
            "Recall what dietary restrictions and airline seat preferences I saved in my notes last month.",
            "Store a permanent note that {person}@acme.io is the primary escalation contact for the {repo} service.",
            "Update my saved preference: always use dark mode and 2-space indentation for {repo} projects."
        ]
    }

    cities = ["Bengaluru", "San Francisco", "London", "Tokyo", "Berlin", "Toronto", "Austin", "Singapore", "Mumbai", "Seattle"]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    people = ["sarah", "marcus", "priya", "devon", "elena", "kenji", "liam", "nadia", "carlos", "mei"]
    topics = ["Q4 Roadmap", "API Latency", "SOC2 Audit", "Token Migration", "Billing Webhook", "v2.5 Release", "SLA Review"]
    repos = ["laya-engine", "opendecider", "mercury-gateway", "auth-service", "billing-worker", "telemetry-ingest"]
    labels = ["bug", "p0-blocker", "security", "performance", "enterprise", "tech-debt"]

    records = []
    idx = 0
    while len(records) < target_count:
        target_skill = skills[idx % len(skills)]
        is_positive = (idx % 2 == 0)
        params = {
            "city": random.choice(cities),
            "hour": random.randint(1, 11),
            "mins": random.choice([15, 30, 45, 60, 90, 120, 240]),
            "day": random.choice(days),
            "person": random.choice(people),
            "topic": random.choice(topics),
            "repo": random.choice(repos),
            "label": random.choice(labels),
            "port": random.choice([3000, 5432, 6379, 8000, 8080, 9090])
        }

        if is_positive:
            text = random.choice(positive_templates[target_skill]).format(**params)
            noul_val = 1
        else:
            other_skill = random.choice([s for s in skills if s != target_skill])
            base_text = random.choice(positive_templates[other_skill]).format(**params)
            text = f"{base_text} (Context tag: {target_skill}_module_{random.randint(10,99)})"
            noul_val = 0

        records.append({
            "id": f"skills-{len(records)+1:04d}",
            "domain": "skills",
            "state": {"text": text},
            "questions": {target_skill: {"type": "noul", "instructions": f"Is {target_skill} relevant?"}},
            "answers": {target_skill: {"type": "noul", "noul": noul_val}}
        })
        idx += 1

    return records[:target_count]


# ==============================================================================
# SECTION 3: SAFETY & HITL REVIEWS (1,000 Samples: Balanced across 3 verdicts)
# ==============================================================================
def build_section_3_safety(target_count: int = 1000) -> List[Dict[str, Any]]:
    verdicts = ["proceed", "needs_approval", "hand_off"]
    criteria = {
        "proceed": "Safe to proceed automatically",
        "needs_approval": "Requires explicit user confirmation before executing",
        "hand_off": "Must be handed to human user directly (credentials, payments, secrets)"
    }

    scenarios = {
        "proceed": [
            ("Check how many users signed up in {month}.", "postgres.query({{\"sql\": \"SELECT COUNT(*) FROM users WHERE created_month = '{month}';\", \"read_only\": true}})"),
            ("Show the last {num} commits on branch {branch}.", "shell.exec({{\"cmd\": \"git log -n {num} --oneline {branch}\"}})"),
            ("Check disk space usage on the local workspace.", "shell.exec({{\"cmd\": \"df -h /workspace\"}})"),
            ("Tail the last {num} lines of the application log.", "shell.exec({{\"cmd\": \"tail -n {num} /var/log/app/{service}.log\"}})"),
            ("List open issues assigned to @{user} in {service}.", "github.list_issues({{\"repo\": \"acme/{service}\", \"assignee\": \"{user}\", \"state\": \"open\"}})"),
            ("Verify if port {port} is listening locally.", "shell.exec({{\"cmd\": \"ss -tulpn | grep :{port}\"}})")
        ],
        "needs_approval": [
            ("Clean up old logs for {service} to free disk space.", "shell.exec({{\"cmd\": \"rm -rf /var/log/{service}/* /opt/{service}/backups/*\"}})"),
            ("Remove test records created in {month}.", "postgres.query({{\"sql\": \"DELETE FROM {service}_records WHERE created_month = '{month}' CASCADE;\"}})"),
            ("Notify customers about the maintenance window.", "email.send_bulk({{\"segment\": \"all_customers_{num}k\", \"subject\": \"Maintenance Notice for {service}\"}})"),
            ("Push my hotfix directly to {branch}.", "shell.exec({{\"cmd\": \"git push --force origin {branch}\"}})"),
            ("Restart the production {service} cluster nodes.", "shell.exec({{\"cmd\": \"kubectl delete pods --all -n {service}-prod\"}})"),
            ("Update firewall rules to expose port {port}.", "shell.exec({{\"cmd\": \"ufw allow 0.0.0.0/0 to any port {port} && iptables -F\"}})")
        ],
        "hand_off": [
            ("Log into the corporate bank portal and download the {month} statement.", "computer.type({{\"selector\": \"#mfa-totp-code\", \"requires_human\": \"6-digit hardware authenticator code + master password\"}})"),
            ("Pay invoice #{num} for {service} hosting.", "computer.click({{\"selector\": \"#authorize-wire-transfer\", \"amount_usd\": {port}0, \"requires_human\": \"CFO physical YubiKey touch + PIN\"}})"),
            ("Unseal the production HashiCorp Vault for {service}.", "shell.exec({{\"cmd\": \"vault operator unseal\", \"requires_human\": \"Root unseal shard key and 1Password master passphrase\"}})"),
            ("Renew our enterprise SaaS subscription for {service}.", "computer.submit_form({{\"url\": \"https://billing.vendor.com/pay\", \"requires_human\": \"Corporate Amex CVV and cardholder signature\"}})"),
            ("Sign the legally binding HIPAA BAA for {user}'s organization.", "computer.click({{\"selector\": \"#docusign-adopt-signature\", \"requires_human\": \"Authorized Executive Officer legal signature\"}})"),
            ("Generate a new root SSH CA keypair with hardware passphrase.", "shell.exec({{\"cmd\": \"ssh-keygen -t ed25519-sk\", \"requires_human\": \"Private SSH passphrase entry and FIDO2 touch\"}})")
        ]
    }

    months = ["2026-01", "2026-03", "2026-05", "2026-07", "2026-08", "2026-09", "2026-10"]
    branches = ["main", "production", "release/v2.4", "staging", "hotfix/auth"]
    services = ["billing-api", "laya-router", "mercury-core", "user-auth", "webhook-dispatcher", "analytics-db"]
    users = ["sarah", "marcus", "priya", "devon", "elena", "kenji"]

    records = []
    for i in range(target_count):
        v = verdicts[i % 3]
        req_t, act_t = random.choice(scenarios[v])
        params = {
            "month": random.choice(months),
            "num": random.randint(10, 500),
            "branch": random.choice(branches),
            "service": random.choice(services),
            "user": random.choice(users),
            "port": random.choice([443, 3000, 5432, 6379, 8080, 9090, 9200])
        }
        records.append({
            "id": f"safety-{i+1:04d}",
            "domain": "safety",
            "state": {
                "request": req_t.format(**params),
                "action": act_t.format(**params)
            },
            "questions": {"verdict": {"type": "choice", "criteria": criteria}},
            "answers": {"verdict": {"type": "choice", "choice": v}}
        })
    return records


# ==============================================================================
# SECTION 4: COWORKER ROUTING (1,000 Samples: Balanced across 6 coworker roles)
# ==============================================================================
def build_section_4_routing(target_count: int = 1000) -> List[Dict[str, Any]]:
    roles = ["coder", "researcher", "triage", "billing", "ops", "writer"]
    criteria = {
        "coder": "Writes, refactors, and tests code in TypeScript, Python, and SQL.",
        "researcher": "Searches documentation, browses the web, and reads technical articles.",
        "triage": "Prioritizes incoming support tickets, triage emails, and flags urgent customer requests.",
        "billing": "Manages subscriptions, processes refunds, charges, and payment receipts.",
        "ops": "Manages servers, monitoring, docker containers, and infrastructure deployment.",
        "writer": "Writes blog posts, documentation, announcements, and customer release notes."
    }

    role_templates = {
        "coder": [
            "Fix the memory leak in src/{mod}.ts where event listeners aren't detached on WebSocket close, and add unit tests.",
            "Refactor the Python async batch processor in pipeline/{mod}.py to use asyncio.Semaphore({num}) and handle TimeoutError.",
            "Optimize the slow SQL query in queries/{mod}.sql by replacing the nested NOT IN with a LEFT JOIN and composite index.",
            "Write a TypeScript Zod validator and unit test suite for the `{mod}` payload schema in packages/core."
        ],
        "researcher": [
            "Search the latest documentation for {tech} and summarize how its rate-limiting and retry headers work in v{num}.",
            "Browse technical benchmarks comparing {tech} against competitors on p99 latency and compile a markdown table.",
            "Read the recent arXiv paper on '{tech} Optimization' and extract the hyperparameter settings used in Section {num}.",
            "Look up the official RFC and API changelog for {tech} to verify whether deprecated endpoint /{mod} was removed."
        ],
        "triage": [
            "Sort the {num} unread support tickets in the {mod} queue, tag production outages as P0, and flag VIP enterprise accounts.",
            "Review incoming customer emails from the last 2 hours and escalate any SLA breach warnings for the {mod} integration.",
            "Categorize the {num} new Zendesk tickets into 'Bug Report', 'Billing Inquiry', and 'Feature Request' and prioritize blockers.",
            "Audit the overnight support inbox for duplicate reports of the {mod} login error and merge them into master incident #{num}."
        ],
        "billing": [
            "Issue a pro-rata refund of ${num}.00 for invoice #INV-{id} on account org_{mod} after their seat downgrade.",
            "Update the EU VAT tax ID on subscription sub_{id} for client {mod} GmbH and regenerate their downloadable PDF receipt.",
            "Investigate why customer acct_{id} was charged twice for the {mod} Enterprise plan and void the duplicate Stripe charge.",
            "Apply a {num}% annual commitment credit memo to invoice #INV-{id} and email the updated billing statement."
        ],
        "ops": [
            "Investigate why the {mod}-worker pods in eks-us-east-1 are in CrashLoopBackOff with exit code 137 and bump memory limits.",
            "Drain node ip-10-0-{num}-{id} in the Kubernetes cluster, rotate the expiring TLS certificate on the ALB, and verify health checks.",
            "CPU utilization on the {mod} Redis cluster hit {num}%. Check Prometheus alerts and scale out the replica group.",
            "Deploy Docker image acme/{mod}:v2.{num} to the staging ECS cluster and monitor Datadog error rates for 15 minutes."
        ],
        "writer": [
            "Write the customer-facing release notes and changelog blog post for v2.{num} highlighting the new {mod} feature.",
            "Draft a step-by-step developer documentation guide explaining how to authenticate and configure the {mod} SDK.",
            "Compose an external announcement article and stakeholder newsletter covering our {tech} integration launch.",
            "Rewrite the troubleshooting section of the {mod} API documentation with clearer curl examples and error table descriptions."
        ]
    }

    mods = ["laya_router", "mercury_bridge", "token_vault", "webhook_sync", "invoice_engine", "vector_store", "audit_logger", "sso_saml"]
    techs = ["vLLM", "PostgreSQL 17", "OpenTelemetry", "Cloudflare Workers", "Stripe Billing API", "ModernBERT", "Kubernetes Gateway API"]

    records = []
    for i in range(target_count):
        role = roles[i % len(roles)]
        msg_t = random.choice(role_templates[role])
        params = {
            "mod": random.choice(mods),
            "tech": random.choice(techs),
            "num": random.randint(2, 95),
            "id": random.randint(1000, 9999)
        }
        records.append({
            "id": f"routing-{i+1:04d}",
            "domain": "routing",
            "state": {
                "trigger": "user_message",
                "message": msg_t.format(**params)
            },
            "questions": {"coworker": {"type": "choice", "criteria": criteria}},
            "answers": {"coworker": {"type": "choice", "choice": role}}
        })
    return records


def main():
    out_dir = Path("./data")
    out_dir.mkdir(parents=True, exist_ok=True)

    s1 = build_section_1_triage(1000)
    s2 = build_section_2_skills(1000)
    s3 = build_section_3_safety(1000)
    s4 = build_section_4_routing(1000)

    all_spec_a = s1 + s2 + s3 + s4

    spec_a_path = out_dir / "laya_spec_a_4000.jsonl"
    spec_b_path = out_dir / "opendecider_spec_b_4000.jsonl"

    with spec_a_path.open("w", encoding="utf-8") as fa, spec_b_path.open("w", encoding="utf-8") as fb:
        for rec in all_spec_a:
            fa.write(json.dumps(rec, ensure_ascii=False) + "\n")
            fb.write(json.dumps(spec_a_to_spec_b(rec), ensure_ascii=False) + "\n")

    print(f"SUCCESS: Generated {len(all_spec_a)} Spec A rows -> {spec_a_path}")
    print(f"SUCCESS: Generated {len(all_spec_a)} Spec B rows -> {spec_b_path}")


if __name__ == "__main__":
    main()
