#!/usr/bin/env python3
"""OpenDuet decider dataset generator (OpenDecider SFT + Laya System-One).

Usage: python gen_openduet.py [out_dir] [samples_per_domain]
Deterministic (seeded). Emits, per domain and combined:
  system1_<domain>.jsonl  (Specification A)
  sft_<domain>.jsonl      (Specification B)
"""
import json, random, os, sys
from collections import Counter

SEED = 20261029
R = random.Random(SEED)
OUT = sys.argv[1] if len(sys.argv) > 1 else "openduet_datasets"
N = int(sys.argv[2]) if len(sys.argv) > 2 else 1000


def pick(x):
    return R.choice(x)


def lc(s):
    return s[:1].lower() + s[1:]


def fmt(obj, c):
    if isinstance(obj, str):
        return obj.format(**c)
    if isinstance(obj, dict):
        return {k: fmt(v, c) for k, v in obj.items()}
    if isinstance(obj, list):
        return [fmt(v, c) for v in obj]
    return obj


# ---------------------------------------------------------------- shared pools
FIRST = ["Priya", "Rahul", "Ananya", "Vikram", "Sneha", "Arjun", "Meera", "Karan", "Divya", "Rohan",
         "Sarah", "Michael", "Emily", "David", "Jessica", "Daniel", "Laura", "James", "Olivia", "Chris",
         "Hannah", "Tom", "Aisha", "Omar", "Mateo", "Sofia", "Liam", "Chen", "Yuki", "Elena"]
LAST = ["Sharma", "Patel", "Iyer", "Deshmukh", "Kulkarni", "Smith", "Johnson", "Brown", "Lee", "Garcia",
        "Martinez", "Khan", "Nguyen", "Rossi", "Schmidt", "Tanaka", "Wilson", "Clark", "Lopez", "Anderson"]
COMPANIES = ["Northwind Logistics", "Acme Robotics", "Bluepeak Analytics", "Orchid Health", "Helios Energy",
             "Pinecone Foods", "Zenith Textiles", "Brightpath Learning", "Quanta Systems", "Lakeside Realty",
             "Redwood Capital", "Silverline Freight", "Nimbus Cloud", "Harborview Labs", "Crestview Legal",
             "Falconridge Media", "Tidewater Marine", "Ironbark Mining"]
VENDORS = ["PayFlow", "CloudNest", "DataVault", "MailRelay", "ShipFast", "DomainHub", "StreamBox", "CodeShelf",
           "FitTrack", "ParcelPoint", "TaskNest", "NoteForge", "PixelPress", "BillEase"]
PROJECTS = ["Atlas", "Orion", "Phoenix", "Mercury", "Aurora", "Pegasus", "Titan", "Nova", "Zephyr", "Delta",
            "Horizon", "Compass", "Beacon", "Lighthouse"]
PRODUCTS = ["standing desk", "espresso machine", "4K monitor", "office chair", "router", "laptop stand",
            "server rack", "label printer", "solar charger", "pallet of sensors", "ergonomic keyboard"]
CARRIERS = ["BlueDart", "DHL", "FedEx", "UPS", "Delhivery", "Royal Mail", "DTDC"]
CITIES = ["Pune", "Mumbai", "Kolhapur", "Bengaluru", "Delhi", "London", "Berlin", "Austin", "Seattle", "Tokyo",
          "Singapore", "Toronto", "Sydney", "Dubai", "Paris", "Chennai", "Hyderabad", "Lisbon"]
SERVICES = ["hosting", "cloud storage", "email suite", "analytics", "CRM", "VPN", "CI runner", "domain registry"]
TOPICS = ["machine learning", "cloud security", "remote work", "supply chain", "fintech", "renewable energy",
          "product design", "data engineering", "healthcare AI", "e-commerce", "cybersecurity", "DevOps"]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "tomorrow",
        "next Monday", "next Friday", "this Friday", "next Wednesday"]
TIMES = ["9 AM", "10:30 AM", "noon", "2 PM", "3:30 PM", "4 PM", "5 PM", "6:30 PM", "8 AM", "11 AM"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
LIBS = ["React", "FastAPI", "Prisma", "pandas", "Redis", "Kafka", "Terraform", "Celery", "Django", "Next.js",
        "SQLAlchemy", "Express", "PyTorch", "gRPC", "Playwright"]
FEATURES = ["dark mode", "SSO login", "bulk export", "usage dashboard", "webhooks", "audit logs",
            "team workspaces", "offline sync", "API keys", "scheduled reports", "two-step approvals"]
REPOS = ["acme/api", "acme/web", "openduet/core", "orion/billing", "nova/mobile", "atlas/infra", "pegasus/docs",
         "zephyr/worker", "delta/sdk", "beacon/dashboard"]
TABLES = ["users", "orders", "invoices", "payments", "sessions", "events", "products", "tickets", "customers",
          "audit_logs", "subscriptions", "shipments"]
COLS = ["status", "created_at", "email", "region", "plan", "last_login", "total", "currency"]
SVCS = ["api-gateway", "auth-service", "worker", "redis", "postgres", "nginx", "billing-service", "search",
        "notifier", "scheduler"]
USERS = [("Alex", "alex@northcode.dev"), ("Sam", "sam.rao@brightlabs.io"), ("Jordan", "jordan@kitehouse.com"),
         ("Priya", "priya@lumenworks.co"), ("Taylor", "taylor@fernmill.org")]


def slug(s):
    return s.lower().replace(" ", "")


def dedupe_build(cycle, make, target, label, seen, what):
    """cycle: list of templates; make(tpl) -> (key, item); fills until target."""
    out, attempts, i = [], 0, 0
    while len(out) < target:
        attempts += 1
        if attempts > target * 400:
            raise RuntimeError(f"cannot reach {target} unique for {what}")
        tpl = cycle[attempts % len(cycle)]
        key, item = make(tpl)
        if (label, key) in seen:
            continue
        seen.add((label, key))
        out.append(item)
        i += 1
    return out


# ================================================================ DOMAIN 1: EMAIL
EMAIL_Q = {"needs_you": {"type": "noul", "instructions": "Does this email require direct action today?"}}


def ectx():
    u = pick(USERS)
    fn, ln, fn2 = pick(FIRST), pick(LAST), pick(FIRST)
    comp, vend = pick(COMPANIES), pick(VENDORS)
    cdom = slug(comp) + ".com"
    vdom = slug(vend) + ".com"
    d = R.randint(3, 60)
    c = dict(
        u=u[0], uemail=u[1], fn=fn, ln=ln, fn2=fn2, sender=f"{fn} {ln}", sender2=f"{fn2} {pick(LAST)}",
        pemail=f"{fn.lower()}.{ln.lower()}@{cdom}", company=comp, cdom=cdom, vendor=vend, vdom=vdom,
        amount=f"${R.randint(12, 9800):,}.{R.randint(0, 99):02d}", inv=R.randint(1000, 99999),
        order=f"#{R.randint(100000, 999999)}", proj=pick(PROJECTS), product=pick(PRODUCTS),
        carrier=pick(CARRIERS), city=pick(CITIES), n=R.randint(2, 48), d=d, h=R.randint(2, 11),
        svc=pick(SERVICES), topic=pick(TOPICS), day=pick(DAYS), month=pick(MONTHS), feature=pick(FEATURES),
        card=R.randint(1000, 9999), dom=f"{slug(pick(COMPANIES))}.{pick(['com', 'io', 'co'])}",
        hour=pick(["3 PM", "5 PM", "noon", "4:30 PM", "end of day", "6 PM IST", "11 AM", "2 PM"]),
        os=pick(["Windows", "macOS", "Linux", "Android", "iPhone"]), chan=pick(["general", "design", "random"]),
        kid=pick(FIRST), school=pick(["Maplewood Academy", "Riverside School", "St. Mary's", "Greenfield Elementary"]),
        spamdom=pick(["lotto-winners.biz", "fast-cash.info", "prizeclaim.net"]),
        rnd=f"{pick(FIRST).lower()}{R.randint(10, 9999)}",
    )
    c["greet"] = pick([f"Hi {u[0]},", f"Hello {u[0]},", f"Hey {u[0]},", "Hi,", "Hello,", f"Dear {u[0]},", ""])
    c["sign"] = pick([f"Thanks,\n{fn}", f"Best regards,\n{fn} {ln}", f"Regards,\n{fn} {ln}\n{comp}", f"- {fn}",
                      f"Thank you,\n{fn} {ln}"])
    return c


HDR = {
    None: lambda c: {},
    "auto": lambda c: {"Auto-Submitted": "auto-generated"},
    "bulk": lambda c: {"Precedence": "bulk", "List-Unsubscribe": f"<mailto:unsubscribe@{c['vdom']}>"},
    "prio": lambda c: {"X-Priority": "1"},
}

# (from, subject, body, base_prob, header_kind)
POS = [
    # broken shipments
    ("ops@{vdom}", "Shipment {order} held at {city} customs - signature needed today",
     "{greet}\n\nYour shipment {order} is on hold at {city} customs. They need a signed commercial invoice by {hour} today, otherwise the container moves to storage at {amount} per day.\n\nPlease reply with the signed copy as soon as you can.\n\n{sign}", 0.99, None),
    ("{pemail}", "Customer reports {product} arrived broken - decision needed today",
     "{greet}\n\n{sender2} just wrote in that the {product} from order {order} arrived damaged. They want a replacement or refund today or they will dispute the charge. Which should we offer? I can action it as soon as you tell me.\n\n{sign}", 0.97, None),
    ("dispatch@{vdom}", "Delivery failed for {order} - confirm address by {hour}",
     "{greet}\n\n{carrier} could not deliver your package {order}. Unless you confirm the delivery address by {hour} today, it will be returned to the sender and your order cancelled.\n\n{sign}", 0.93, "auto"),
    ("warehouse@{cdom}", "{n} pallets of {product} missing - re-ship or refund?",
     "{greet}\n\nWe counted {n} pallets short on the {city} inbound check. The carrier cut-off is {hour}. I need your call on re-ship vs refund before then.\n\n{sign}", 0.98, None),
    # failed payments
    ("billing@{vdom}", "Payment failed - {svc} will be suspended today",
     "{greet}\n\nWe could not charge the card ending {card} for {amount}. Your {svc} account will be suspended at {hour} today unless you update your payment method.\n\n{vendor} Billing", 0.96, "auto"),
    ("alerts@{vdom}", "Action required: payroll funding of {amount} failed",
     "{greet}\n\nThe payroll run for {n} employees cannot be released until funding clears. Please top up the account before {hour} so salaries land on time.\n\n{sign}", 0.99, "auto"),
    ("noreply@{vdom}", "Domain {dom} expires today - renewal declined",
     "Your renewal payment of {amount} for {dom} was declined. The domain expires at midnight tonight and your website and email will stop working. Update billing now.", 0.97, "auto"),
    ("accounts@{vdom}", "Invoice {inv} is overdue - service termination tomorrow",
     "{greet}\n\nInvoice {inv} for {amount} is now {d} days past due. Payment must be received by {hour} today to avoid immediate disconnection.\n\n{sign}", 0.97, None),
    # signature deadlines
    ("sign@{vdom}", "Signature required: {proj} agreement expires today",
     "{sender} has asked you to sign the '{proj} Services Agreement'. The signing link expires at {hour} today.", 0.95, "auto"),
    ("{pemail}", "Please sign the {proj} addendum before {hour}",
     "{greet}\n\nLegal needs your signature on the addendum before the {hour} call with {company}. It is two pages and only page 2 needs signing.\n\n{sign}", 0.97, None),
    ("{pemail}", "Court filing - declaration needs your signature today",
     "{greet}\n\nCounsel needs your signed declaration by {hour} today to meet the filing deadline. Please review the attached and sign.\n\n{sign}", 0.98, None),
    ("hr@{cdom}", "Offer letter for {fn2} - your countersignature needed by {hour}",
     "{greet}\n\nThe offer to {fn2} lapses today if you do not countersign by {hour}. The candidate has another offer pending.\n\n{sign}", 0.95, None),
    # urgent clients
    ("{pemail}", "URGENT: production site down for {company}",
     "{greet}\n\nOur production site has been down for 20 minutes and customers are calling. Can you join the incident bridge right now? Revenue impact is about {amount} per hour.\n\n{sign}", 0.99, "prio"),
    ("{pemail}", "Need your answer on {proj} pricing today",
     "{greet}\n\nOur board meets this afternoon and I need your final price for {proj} before then. If I cannot give them a number by {hour}, we will go with the other vendor.\n\n{sign}", 0.97, None),
    ("{pemail}", "Re: contract redlines - need your response by EOD",
     "{greet}\n\nWe accepted most of your edits but section {n} is a blocker. Our counsel needs your reply today so we can sign tomorrow morning.\n\n{sign}", 0.94, None),
    ("{pemail}", "Escalation: {company} is threatening to cancel",
     "{greet}\n\n{company} says the {feature} issue has blocked their team for {d} days. Their VP wants a call with you today or they will not renew.\n\n{sign}", 0.97, None),
    # colleagues / approvals
    ("{pemail}", "Quick approval needed: PO {inv}",
     "{greet}\n\nNeed your sign-off on PO {inv} ({amount}) before the supplier's {hour} cut-off. Reply 'approved' and I will release it.\n\n{sign}", 0.95, None),
    ("{pemail}", "can you join the {hour} call?",
     "hey - {fn2} is out sick and the client asked for you specifically. can you hop on at {hour}?", 0.90, None),
    ("{pemail}", "Need your OK to roll back the {proj} release",
     "{greet}\n\nThe {proj} release is throwing errors for {n} percent of users. I would like to roll back but need your approval. Can you reply in the next 15 minutes?\n\n{sign}", 0.98, "prio"),
    ("{pemail}", "quick q",
     "hey - {company} just asked where their invoice {inv} is and they are calling at {hour}. can you send it before then?", 0.90, None),
    # security needing action
    ("security@{cdom}", "Confirm: did you approve this admin change?",
     "An admin role was granted to {fn2} on your account at 09:12. If this was not you, reply immediately so we can lock it down. The change applies automatically at {hour}.", 0.93, "auto"),
    ("it@{cdom}", "SSH key rotation due today - deploys fail after {hour}",
     "{greet}\n\nYour deploy key expires today. Please upload a new public key by {hour} or CI deploys under your name will start failing.\n\n{sign}", 0.91, None),
    # legal / time-bound
    ("{pemail}", "Tax documents needed by {hour} today",
     "{greet}\n\nOur accountant cannot file without your signed form and bank statements by {hour} today. The extension window closes tonight.\n\n{sign}", 0.96, None),
    ("appointments@{vdom}", "Appointment moved to today at {hour} - confirm attendance",
     "Your appointment with {sender} in {city} was moved to today at {hour}. Please confirm within 2 hours or the slot is given to the next person.", 0.90, "auto"),
    # personal urgent
    ("office@{slug_school}", "Please pick up {kid} - not feeling well",
     "{greet}\n\n{kid} has a fever and needs to go home. Please collect them from the front office as soon as possible.\n\n{school} Front Office", 0.99, None),
    ("{pemail}", "Water leak in your unit - need access today",
     "{greet}\n\nA pipe is leaking and water is reaching the flat below. Please call me or let the plumber in today before {hour}.\n\n{sign}", 0.97, None),
    # recruiting
    ("recruiting@{cdom}", "Interview panel: need you at {hour} today",
     "{greet}\n\nOne panelist dropped out. Can you cover the {hour} interview for the senior role? The candidate is already waiting.\n\n{sign}", 0.94, None),
]

NEG = [
    # autopay receipts
    ("receipts@{vdom}", "Your receipt from {vendor} - {amount}",
     "{greet}\n\nThanks for your payment of {amount}. It was charged automatically to the card ending {card}. No action is needed.\n\n{vendor} Billing", 0.02, "auto"),
    ("noreply@{vdom}", "Payment received - invoice {inv}",
     "We received your autopay of {amount}. Your next billing date is {day}. Nothing else is required.", 0.02, "auto"),
    ("billing@{vdom}", "Your {month} statement is ready",
     "Your statement is now available in your account. Autopay will draw {amount} on {day}. You do not need to do anything.", 0.03, "auto"),
    # newsletters
    ("news@{cdom}", "{company} Weekly: {n} trends in {topic}",
     "This week in {topic}: {n} trends to watch, plus our editor's picks.\n\nRead in browser | Unsubscribe", 0.01, "bulk"),
    ("digest@{vdom}", "The {topic} Digest - Issue #{inv}",
     "Top stories on {topic} this week. You are receiving this because you subscribed.\n\nUnsubscribe anytime.", 0.01, "bulk"),
    ("hello@{vdom}", "What's new in {vendor} this month",
     "We shipped {feature}, improved performance, and fixed {n} bugs. Read the full changelog on our blog.", 0.02, "bulk"),
    # social alerts
    ("notifications@{vdom}", "{sender} liked your photo",
     "{sender} and {n} others liked your recent photo. See who else reacted.", 0.01, "bulk"),
    ("notifications@{vdom}", "You have {n} new connection requests",
     "{sender} and {n} others want to connect with you. View requests whenever you like.", 0.02, "bulk"),
    ("no-reply@{vdom}", "Trending in your network: {topic}",
     "{sender} shared a post about {topic}. See what people are saying.", 0.01, "bulk"),
    # cold outreach
    ("{pemail}", "Quick question about {company}'s {proj}",
     "Hi {u},\n\nI came across {company} and wanted to reach out. We help teams cut {topic} costs by {d} percent. Would you be open to a 15-minute call next week?\n\n{sign}", 0.04, None),
    ("{pemail}", "Partnership opportunity with {company}",
     "Hello {u},\n\nI lead partnerships at {company}. We think our {svc} would be a great fit for your team. Happy to send a deck if useful.\n\n{sign}", 0.04, None),
    ("{pemail}", "Re: re: my last email",
     "Hi {u}, just bumping this to the top of your inbox in case you missed it. Let me know if you would like a demo.\n\n{sign}", 0.05, None),
    # marketing with pseudo urgency
    ("deals@{vdom}", "URGENT: your {d}% discount expires tonight!!!",
     "Hurry! Only {h} hours left to save {d}% on everything. Shop now before it is gone.\n\nUnsubscribe", 0.04, "bulk"),
    ("promo@{vdom}", "Final notice: items in your cart are selling out",
     "Your {product} is almost gone. Complete your order in the next {h} hours to keep your price.\n\nManage preferences", 0.04, "bulk"),
    ("hello@{vdom}", "Action required: claim your free {product}",
     "Congratulations! Click below to claim your free {product} with any purchase over {amount}. Offer ends soon.", 0.05, "bulk"),
    ("events@{vdom}", "Last chance: register for the {topic} webinar",
     "Seats are filling fast for our {topic} webinar on {day}. Reserve your spot now.\n\nUnsubscribe", 0.04, "bulk"),
    # calendar acceptances
    ("{pemail}", "Accepted: {proj} sync @ {day} {hour}",
     "{sender} has accepted this invitation.", 0.01, "auto"),
    ("calendar-notification@{vdom}", "{sender} accepted: {proj} review",
     "{sender} accepted your invitation for the {proj} review on {day}. No further action needed.", 0.01, "auto"),
    # explicit no action needed / FYI
    ("{pemail}", "FYI: {proj} status update (no action needed)",
     "{greet}\n\nJust keeping you in the loop. {proj} is on track and we shipped {feature}. No action needed from you.\n\n{sign}", 0.03, None),
    ("{pemail}", "Meeting notes - for your records",
     "{greet}\n\nNotes from today's {proj} sync are attached. No reply needed.\n\n{sign}", 0.02, None),
    ("{pemail}", "Re: {proj} - sorted, ignore my earlier message",
     "{greet}\n\nI already handled this myself, thanks. No need to do anything.\n\n{sign}", 0.03, None),
    ("{pemail}", "Resolved: incident {inv} (was URGENT)",
     "{greet}\n\nThe incident is resolved and services are healthy. A postmortem is scheduled for next week; nothing is needed from you now.\n\n{sign}", 0.05, None),
    # shipping / delivery ok
    ("shipping@{vdom}", "Your order {order} was delivered",
     "Your {product} was delivered to the front door today. Enjoy! Rate your experience when you have a moment.", 0.02, "auto"),
    ("track@{vdom}", "Your package is on its way - arriving {day}",
     "{carrier} has your order {order}. It is on schedule to arrive {day}. No action is required.", 0.03, "auto"),
    # system digests
    ("noreply@{vdom}", "Your weekly activity summary",
     "You had {n} active days this week and used {d} percent of your plan. See details in your dashboard.", 0.01, "auto"),
    ("backup@{cdom}", "Backup completed successfully",
     "The nightly backup finished in {d} minutes. {n} files were copied. No errors.", 0.01, "auto"),
    ("noreply@{vdom}", "Monthly usage report for {svc}",
     "Your {svc} usage for {month} is attached. Total charges: {amount}, billed automatically.", 0.02, "auto"),
    # account informational
    ("legal@{vdom}", "We're updating our privacy policy",
     "We are updating our policy effective {day}. You do not need to take any action.", 0.02, "bulk"),
    ("security@{vdom}", "Your password was changed",
     "Your password was changed successfully. If this was you, you can ignore this message.", 0.08, "auto"),
    ("security@{vdom}", "New sign-in from {os}",
     "We noticed a new sign-in to your account from {os} in {city}. If this was you, no action is needed.", 0.10, "auto"),
    # spam
    ("{rnd}@{spamdom}", "You have been selected - claim your prize",
     "Dear beneficiary, you have won {amount} in our international draw. Reply with your bank details to receive your funds.", 0.01, None),
    # mailing list / events
    ("dev-list@{vdom}", "[{proj}-dev] Re: build failure on arm64",
     "On {day}, {sender} wrote:\n> The arm64 build fails with a linker error.\n\nI see the same thing, probably the new toolchain. Will look into it later.", 0.03, "bulk"),
    ("events@{cdom}", "Save the date: annual summit on {day}",
     "Our annual summit returns in {month}. Registration opens soon and we will send details then.", 0.03, "bulk"),
]


def make_email_sample(tpl):
    c = ectx()
    c["slug_school"] = slug(c["school"]) + ".edu"
    frm, subj, body, base, hk = tpl
    d = dict(c)
    st = {
        "from": frm.format(**d),
        "to": [c["uemail"]],
        "subject": subj.format(**d),
        "body": body.format(**d).strip(),
        "headers": HDR[hk](c),
    }
    p = max(0.0, min(1.0, base + R.uniform(-0.02, 0.02)))
    p = round(p, 2)
    key = (st["subject"], st["body"])
    return key, (st, p)


def gen_email(n):
    seen = set()
    pos = dedupe_build(POS, make_email_sample, n // 2, "pos", seen, "email pos")
    neg = dedupe_build(NEG, make_email_sample, n - n // 2, "neg", seen, "email neg")
    items = pos + neg
    R.shuffle(items)
    out = []
    for i, (st, p) in enumerate(items, 1):
        out.append(dict(id=f"email-{i:04d}", domain="email_triage", state=st, questions=EMAIL_Q,
                        answers={"needs_you": {"type": "noul", "noul": p}}))
    return out


# ================================================================ DOMAIN 2: SKILLS
SKILL_SLUGS = ["weather", "calendar", "email", "github", "shell", "computer", "database", "memory"]
SKILL_Q = {s: {"type": "noul", "instructions": f"Is {s} relevant?"} for s in SKILL_SLUGS}


def skctx():
    return dict(
        city=pick(CITIES), day=pick(DAYS), time=pick(TIMES), name=pick(FIRST), repo=pick(REPOS),
        table=pick(TABLES), table2=pick(TABLES), col=pick(COLS), n=R.randint(2, 480), topic=pick(TOPICS),
        company=pick(COMPANIES), proj=pick(PROJECTS), port=pick([3000, 5432, 8080, 8000, 6379, 9090, 4200]),
        pkg=pick(["jq", "htop", "ripgrep", "tmux", "ffmpeg", "nginx", "postgresql-client"]),
        branch=pick(["feature/login", "fix/null-check", "release/2.4", "chore/deps", "hotfix/cors"]),
        issue=pick(["Login fails on Safari", "Add CSV export", "Memory leak in worker", "Typo in docs",
                    "Support dark mode"]),
        event=pick(["Team standup", "Design review", "1:1 with manager", "Sprint planning", "Lunch with client"]),
        site=pick(["news.ycombinator.com", "example.org", "docs.python.org", "github.com/trending",
                   "wikipedia.org", "shop.example.com"]),
        thing=pick(["editor theme", "coffee order", "preferred language", "standup time", "favorite cuisine",
                    "timezone"]),
        value=pick(["dark mode", "oat milk latte", "Python", "9:30 AM", "South Indian food", "IST"]),
        subject=pick(["Project update", "Quick follow-up", "Invoice question", "Meeting notes", "Intro"]),
        sha=R.randbytes(4).hex(), ver=f"{R.randint(1, 4)}.{R.randint(0, 12)}.{R.randint(0, 9)}",
        var=pick(["API_URL", "NODE_ENV", "DEBUG", "AWS_REGION"]),
        food=pick(["vegetarian", "lactose-free", "gluten-free"]),
        note=pick(["the staging DB password rotates monthly", "call the vendor about the quote",
                   "buy a birthday gift for mom", "renew the domain in March"]),
    )


SKILL_T = {
    "weather": [
        "What's the weather in {city} tomorrow?", "Will it rain in {city} this weekend?",
        "Show me the radar for {city}.", "Do I need an umbrella today in {city}?",
        "Give me the 5-day forecast for {city}.", "How hot will it get in {city} on {day}?",
        "Is there a storm warning near {city}?", "What's the temperature outside right now?",
        "Check wind speed and humidity in {city}.", "Should I wear a jacket for my run in {city} tonight?",
        "Any snow expected in {city} next week?", "What's the UV index in {city} today?",
        "Is it going to be sunny in {city} on {day}?", "Show current conditions and the hourly forecast for {city}.",
    ],
    "calendar": [
        "Schedule a meeting with {name} on {day} at {time}.", "What's on my calendar for {day}?",
        "Find a 30-minute slot next week when both {name} and I are free.", "Move my {time} meeting to {day}.",
        "Accept the invite from {name}.", "Block off {day} afternoon for focus time.",
        "Cancel tomorrow's standup.", "Create a recurring event every Monday at {time} called {event}.",
        "Am I free on {day} at {time}?", "Send a calendar invite for {event} to the team.",
        "Add the dentist appointment to my calendar for {day} at {time}.", "Do I have any conflicts this Friday?",
        "Reschedule {event} to {day}.", "What meetings do I have after {time} today?",
    ],
    "email": [
        "Search my inbox for emails from {name} about {topic}.", "Draft a reply to {name} saying I'll get back to them {day}.",
        "Send an email to {name} with the subject '{subject}'.", "Did I get any email from {company} this week?",
        "Summarize my unread emails from this morning.", "Forward the invoice from {company} to accounting.",
        "Find the email with the attachment about {topic}.", "Reply to the last message from {name} and say thanks.",
        "Show me my unread messages.", "Write an email to {company} support asking for a refund.",
        "Check if {name} replied to my proposal.", "Archive all the newsletters in my inbox.",
        "Compose a follow-up email to {name} about {proj}.", "Look for the mail where {name} sent the contract.",
    ],
    "github": [
        "Show open pull requests in {repo}.", "Create an issue in {repo} titled '{issue}'.",
        "Merge PR #{n} into main.", "What changed in the last commit on {repo}?", "List the issues assigned to me.",
        "Review PR #{n} and leave comments.", "Create a branch called {branch} in {repo}.",
        "Close issue #{n} as completed.", "Who committed to {repo} yesterday?", "Did CI pass on PR #{n}?",
        "Tag a release v{ver} on {repo}.", "Comment on issue #{n} that I'm looking into it.",
        "Show the commit history for {repo} this week.", "Open a pull request from {branch} to main in {repo}.",
    ],
    "shell": [
        "Run `ls -la` in my home directory.", "Check disk usage with df -h.",
        "Write a bash script that renames all .jpeg files to .jpg.", "Find all files larger than 100MB in /var.",
        "Tail the last 50 lines of /var/log/syslog.", "Run a PowerShell command to list running services.",
        "Kill the process listening on port {port}.", "Install {pkg} using apt.",
        "What's my current directory and who am I logged in as?", "Run `npm run build` in the terminal.",
        "grep for TODO across the src folder.", "Set the environment variable {var} in my shell profile.",
        "Show me the top 5 processes by memory usage.", "Write a cron one-liner that runs backup.sh every night.",
    ],
    "computer": [
        "Open {site} in the browser and click the login button.", "Take a screenshot of the current page.",
        "Navigate to the pricing page and scroll to the bottom.", "Fill out the contact form on that website.",
        "Click the third link in the search results.", "Go to {site} and tell me what the headline says.",
        "Snapshot the DOM of this tab.", "Open a new tab and search for {topic}.",
        "Press the download button on the page.", "Scroll down and click 'Load more'.",
        "Type '{topic}' into the search box on the site and hit enter.", "Switch to the second browser tab.",
        "Click the 'Accept cookies' banner and then capture the page.", "Navigate back and click the next product.",
    ],
    "database": [
        "Run a SQL query to count users who signed up last month.", "Show me the schema of the {table} table.",
        "List all tables in the postgres database.", "Select the top 10 customers by revenue.",
        "How many rows are in {table}?", "Write a query joining {table} and {table2} on id.",
        "Describe the columns in {table}.", "Check for duplicate emails in the users table.",
        "Export {table} rows where {col} is not null as CSV.", "What foreign keys reference {table}?",
        "Show the indexes on {table}.", "What is the average {col} per group in {table}?",
        "Find rows in {table} created in the last {n} days.", "Explain the query plan for selecting from {table} by {col}.",
    ],
    "memory": [
        "Remember that I prefer {value} for my {thing}.", "What did I tell you about my {thing}?",
        "Save a note: {note}.", "Recall my notes about {topic}.", "Forget what I said about {topic}.",
        "Keep in mind that I'm {food}.", "Remember my {thing} is {value}.",
        "What's my {thing}? I think I told you before.", "Note to self: {note}.",
        "From now on, call me {name}.", "What do you remember about {name}'s birthday?",
        "Store this for later: {note}.", "Do you still have my notes on {proj}?", "Update my {thing} preference to {value}.",
    ],
}

MULTI = [
    ("Check the weather in {city} for {day} and add a hiking event to my calendar if it's sunny.", ["weather", "calendar"]),
    ("Email {name} the forecast for {city} tomorrow.", ["email", "weather"]),
    ("Find the email from {name} with the meeting time and put it on my calendar.", ["email", "calendar"]),
    ("Open the failing PR #{n} in the browser and take a screenshot of the CI page.", ["github", "computer"]),
    ("Run the migration script in the shell and then verify the {table} table has the new column.", ["shell", "database"]),
    ("Remember that my deploy repo is {repo} and list its open PRs.", ["memory", "github"]),
    ("Query the database for overdue invoices and email the list to {name}.", ["database", "email"]),
    ("Run git log in the terminal and summarize the commits in a GitHub issue for {repo}.", ["shell", "github"]),
    ("Save a note that the {table} backup ran at {time} and check disk space.", ["memory", "shell"]),
    ("Check the weather in {city} and remember that I like running when it's cool.", ["weather", "memory"]),
    ("Look up {name}'s availability on my calendar and draft an email proposing {day}.", ["calendar", "email"]),
    ("Browse to {site}, copy the order id, and look it up in the {table} table.", ["computer", "database"]),
    ("Create a GitHub issue for the bug and send {name} an email with the link.", ["github", "email"]),
    ("Schedule a reminder for {day} and save the details in my notes.", ["calendar", "memory"]),
    ("Restart nginx from the terminal and check the site loads in the browser.", ["shell", "computer"]),
    ("Pull the latest from {repo}, run the tests in the shell, and report the result on the PR.", ["github", "shell"]),
    ("If it's going to rain in {city} on {day}, move my outdoor {event} on the calendar.", ["weather", "calendar"]),
    ("Search my email for the receipt from {company} and store the total in my notes.", ["email", "memory"]),
]

NONE_T = [
    "Hi there!", "Tell me a joke.", "What's the capital of France?", "Explain how photosynthesis works.",
    "Translate 'good morning' into Spanish.", "What is 17 times 23?", "Write a haiku about autumn.",
    "I'm feeling under the weather today.", "Can you help me brainstorm names for my startup?",
    "What's the difference between TCP and UDP?", "Summarize the plot of Hamlet.", "Thanks, that was helpful!",
    "How do I get better at public speaking?", "What does 'branch' mean in biology?", "Is a shell company legal?",
    "Explain what a memory leak is.", "What's the history of the Gregorian calendar?",
    "How does SMTP work in theory?", "Give me a recipe for lentil soup.", "What should I name my dog?",
    "Why is the sky blue?", "Recommend a good book on stoicism.", "What's a good way to stay motivated?",
    "Explain recursion like I'm five.", "Who painted the Mona Lisa?", "How many ounces are in a pound?",
    "What are the pros and cons of remote work?", "Write a limerick about a cat.", "Help me write a toast for my sister's wedding.",
    "What is the meaning of the word 'ephemeral'?", "How do vaccines work?", "Tell me an interesting fact about octopuses.",
    "My computer science exam is tomorrow, any study tips?", "What does a database administrator do for a living?",
]


def skill_sample(kind, tpl):
    c = skctx()
    if kind == "single":
        text = tpl[1].format(**c)
        labels = {tpl[0]}
    elif kind == "multi":
        text = tpl[0].format(**c)
        labels = set(tpl[1])
    else:
        text = tpl
        labels = set()
    r = R.random()
    if r < 0.12:
        text = lc(text).rstrip(".")
    elif r < 0.22:
        text = "Please " + lc(text)
    elif r < 0.30:
        text = "hey, " + lc(text)
    elif r < 0.36:
        text = "Can you " + lc(text).rstrip(".?") + "?"
    elif r < 0.42:
        text = text + " Thanks!"
    ans = {}
    for s in SKILL_SLUGS:
        if s in labels:
            ans[s] = {"type": "noul", "noul": round(min(1.0, 0.98 + R.uniform(0, 0.02)), 2)}
        else:
            ans[s] = {"type": "noul", "noul": round(R.uniform(0.0, 0.02), 2)}
    return text, ans


def gen_skills(n):
    per = (n * 8 // 10) // 8
    n_multi = n // 10
    n_none = n - per * 8 - n_multi
    seen, items = set(), []

    def mk(kind):
        def f(tpl):
            text, ans = skill_sample(kind, tpl)
            return text, (text, ans)
        return f

    for s in SKILL_SLUGS:
        cyc = [(s, t) for t in SKILL_T[s]]
        items += dedupe_build(cyc, mk("single"), per, ("s", s), seen, f"skill {s}")
    items += dedupe_build(MULTI, mk("multi"), n_multi, ("m",), seen, "multi")
    items += dedupe_build(NONE_T, mk("none"), n_none, ("n",), seen, "none")
    R.shuffle(items)
    return [dict(id=f"skill-{i:04d}", domain="skill_selection", state={"text": t}, questions=SKILL_Q, answers=a)
            for i, (t, a) in enumerate(items, 1)]


# ================================================================ DOMAIN 3: SAFETY
SAFETY_CLASSES = ["proceed", "needs_approval", "hand_off"]
SAFETY_Q = {"verdict": {"type": "choice", "criteria": {
    "proceed": "Safe to proceed automatically",
    "needs_approval": "Requires explicit user confirmation before executing",
    "hand_off": "Must be handed to human user directly (credentials, payments, secrets)"}}}


def sctx():
    return dict(
        svc=pick(SVCS), app=pick(["shop", "billing", "portal", "blog", "crm"]), port=pick([3000, 5432, 8080, 6379, 9200]),
        pid=R.randint(1200, 48000), table=pick(TABLES), table2=pick(TABLES), repo=pick(REPOS),
        branch=pick(["feature/login", "fix/null-check", "release/2.4", "hotfix/cors", "chore/deps"]),
        name=pick(FIRST), city=pick(CITIES), ip=f"10.{R.randint(0, 9)}.{R.randint(0, 250)}.{R.randint(2, 250)}",
        ns=pick(["prod", "staging", "payments", "web"]), n=R.randint(12, 9000), amount=f"{R.randint(50, 9000)}",
        topic=pick(TOPICS), lib=pick(["pandas", "react", "numpy", "fastapi"]), pkg=pick(["python3", "nodejs", "openssl"]),
        year=R.randint(2019, 2025), days=R.randint(7, 90), cnt=R.randint(15, 300),
        vendor=pick(VENDORS), tmpdir=pick(["/tmp", "/var/tmp", "/home/deploy/cache"]),
        domain=pick(["acme.io", "example.com", "brightlabs.io"]),
    )


# (request, tool, args)
PROCEED = [
    ("Check how much disk space is left on the server.", "shell.exec", {"command": "df -h"}),
    ("Show me the last 100 lines of the {svc} error log.", "shell.exec", {"command": "tail -n 100 /var/log/{svc}/error.log"}),
    ("What is running on port {port}?", "shell.exec", {"command": "lsof -i :{port}"}),
    ("Which git branch am I on and are there uncommitted changes?", "shell.exec", {"command": "git status"}),
    ("How many users signed up this week?", "db.query", {"sql": "SELECT count(*) FROM users WHERE created_at > now() - interval '7 days'"}),
    ("Show the schema for the {table} table.", "db.query", {"sql": "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table}'"}),
    ("List open pull requests in {repo}.", "github.list_pull_requests", {"repo": "{repo}", "state": "open"}),
    ("Find emails from {name} from the past week.", "email.search", {"query": "from:{name} newer_than:7d"}),
    ("What is on my calendar tomorrow?", "calendar.list_events", {"range": "tomorrow"}),
    ("What is the weather in {city}?", "weather.get_forecast", {"location": "{city}"}),
    ("Take a screenshot of the monitoring dashboard.", "computer.screenshot", {}),
    ("Open the Python json docs page.", "computer.navigate", {"url": "https://docs.python.org/3/library/json.html"}),
    ("Preview what Terraform would change in {ns}.", "shell.exec", {"command": "terraform plan -out=tfplan -lock=false"}),
    ("See which pods are crashing in {ns}.", "shell.exec", {"command": "kubectl get pods -n {ns}"}),
    ("Search the codebase for TODO comments.", "shell.exec", {"command": "grep -rn TODO src/"}),
    ("Check that the nginx config is valid.", "shell.exec", {"command": "nginx -t"}),
    ("Show me what the cleanup script would delete without deleting anything.", "shell.exec", {"command": "rsync -avn --delete /srv/stage/ /srv/live/"}),
    ("Explain the query plan for the slow {table} report.", "db.query", {"sql": "EXPLAIN SELECT * FROM {table} WHERE created_at > now() - interval '{days} days'"}),
    ("List the running docker containers.", "shell.exec", {"command": "docker ps -a"}),
    ("Recall my notes about {topic}.", "memory.recall", {"query": "{topic}"}),
    ("Show the diff between main and {branch}.", "shell.exec", {"command": "git diff main..{branch}"}),
    ("Does the string 'rm -rf' appear anywhere in our deploy scripts?", "shell.exec", {"command": "grep -rn \"rm -rf\" scripts/"}),
    ("How many {table} rows were soft-deleted in the last {days} days?", "db.query", {"sql": "SELECT count(*) FROM {table} WHERE deleted_at >= now() - interval '{days} days'"}),
    ("Read the project README.", "shell.exec", {"command": "cat README.md"}),
    ("Check CPU and memory usage.", "shell.exec", {"command": "top -bn1 | head -20"}),
    ("What is the status of the latest CI run on {repo}?", "github.get_check_runs", {"repo": "{repo}", "ref": "main"}),
    ("List the cron jobs for this user.", "shell.exec", {"command": "crontab -l"}),
    ("Show me the current firewall rules.", "shell.exec", {"command": "iptables -L -n"}),
    ("When did the last backup run?", "shell.exec", {"command": "ls -lt /backups | head -5"}),
    ("Count how many lines of Python are in the repo.", "shell.exec", {"command": "find . -name '*.py' | xargs wc -l | tail -1"}),
    ("Show who is logged in to this machine.", "shell.exec", {"command": "who"}),
    ("List the tables that mention {table2} in a foreign key.", "db.query", {"sql": "SELECT conname FROM pg_constraint WHERE confrelid = '{table2}'::regclass"}),
]

APPROVAL = [
    ("Clean up the temp files.", "shell.exec", {"command": "rm -rf {tmpdir}/*"}),
    ("Free up some disk space.", "shell.exec", {"command": "docker system prune -af --volumes"}),
    ("Tidy my project folder.", "shell.exec", {"command": "rm -rf node_modules dist build .git"}),
    ("Reset my local repo so it matches origin.", "shell.exec", {"command": "git reset --hard origin/main && git clean -fdx"}),
    ("Drop the old staging tables.", "db.query", {"sql": "DROP TABLE {table}_old CASCADE"}),
    ("Remove the test users.", "db.query", {"sql": "DELETE FROM users WHERE email LIKE '%@test.com'"}),
    ("Mark every order as shipped.", "db.query", {"sql": "UPDATE orders SET status = 'shipped'"}),
    ("Let all customers know about the outage.", "email.send_bulk", {"recipients": "all_customers", "count": "{n}", "subject": "Service outage"}),
    ("Send the newsletter to the whole list.", "email.send_bulk", {"list": "subscribers", "count": "{n}", "subject": "{topic} update"}),
    ("Update the nginx config with the new one.", "shell.exec", {"command": "cp /tmp/nginx.conf /etc/nginx/nginx.conf"}),
    ("Let my teammate connect to the database.", "shell.exec", {"command": "ufw allow {port}/tcp from any"}),
    ("Push my changes to main.", "shell.exec", {"command": "git push --force origin main"}),
    ("Deploy to production.", "shell.exec", {"command": "terraform apply -auto-approve"}),
    ("Delete the branches that are already merged.", "github.delete_branches", {"repo": "{repo}", "count": "{cnt}"}),
    ("Close all the stale issues.", "github.bulk_close_issues", {"repo": "{repo}", "count": "{cnt}"}),
    ("Restart the {svc} service.", "shell.exec", {"command": "systemctl restart {svc}"}),
    ("Make the web folder accessible to everyone.", "shell.exec", {"command": "chmod -R 777 /var/www"}),
    ("Remove the old cron jobs.", "shell.exec", {"command": "crontab -r"}),
    ("Kill the stuck process.", "shell.exec", {"command": "kill -9 {pid}"}),
    ("Empty the audit log table.", "db.query", {"sql": "TRUNCATE TABLE audit_logs"}),
    ("Remove the legacy id column.", "db.query", {"sql": "ALTER TABLE {table} DROP COLUMN legacy_id"}),
    ("Cancel all my meetings next week.", "calendar.delete_events", {"range": "next_week", "count": "{cnt}"}),
    ("Publish the package.", "shell.exec", {"command": "npm publish --access public"}),
    ("Merge the PR to main.", "github.merge_pull_request", {"repo": "{repo}", "number": "{pid}", "base": "main"}),
    ("Scale the {svc} down to save cost.", "shell.exec", {"command": "kubectl scale deployment {svc} --replicas=0 -n {ns}"}),
    ("Clear the app log so it is easier to read.", "shell.exec", {"command": "truncate -s 0 /var/log/{svc}/app.log"}),
    ("Overwrite .env with the staging values.", "shell.exec", {"command": "cp .env.staging .env"}),
    ("Restore the database from last night's backup.", "shell.exec", {"command": "pg_restore --clean --dbname=prod /backups/nightly.dump"}),
    ("Turn off the firewall while we debug.", "shell.exec", {"command": "ufw disable"}),
    ("Run the pending migration.", "shell.exec", {"command": "alembic upgrade head"}),
    ("Archive the old repo.", "github.archive_repository", {"repo": "{repo}"}),
    ("Reply-all to the thread with the contract attached.", "email.send", {"to_count": "{cnt}", "attachment": "contract.pdf"}),
    ("Remove the old Python install.", "shell.exec", {"command": "apt remove {pkg} -y"}),
]

HANDOFF = [
    ("Log into my bank and check the balance.", "computer.type", {"selector": "#password", "text": "<USER_PASSWORD>"}),
    ("Enter the 2FA code to finish signing in.", "computer.type", {"selector": "input[name=otp]", "text": "<OTP_CODE>"}),
    ("Pay the {vendor} invoice with my card.", "computer.type", {"selector": "#card-number", "text": "<CARD_NUMBER>"}),
    ("Wire {amount} dollars to the vendor.", "bank.wire_transfer", {"amount": "{amount}", "account_number": "<ACCOUNT_NUMBER>", "routing_number": "<ROUTING_NUMBER>"}),
    ("SSH into the production server as root.", "shell.exec", {"command": "ssh -i /root/.ssh/id_ed25519 root@{ip}"}),
    ("Unlock the password vault.", "vault.unlock", {"master_password": "<MASTER_PASSWORD>"}),
    ("Sign in to my Google account.", "computer.type", {"selector": "input[type=password]", "text": "<USER_PASSWORD>"}),
    ("Complete the checkout for the order.", "checkout.submit_payment", {"payment_method": "saved_card", "total": "{amount}"}),
    ("Approve the transfer with my PIN.", "computer.type", {"selector": "#pin", "text": "<PIN>"}),
    ("Verify my identity on the form.", "computer.type", {"selector": "#passport", "text": "<PASSPORT_NUMBER>"}),
    ("Paste my private key into the deploy form.", "computer.type", {"selector": "textarea#key", "text": "<PRIVATE_KEY>"}),
    ("Answer the sudo password prompt.", "shell.send_stdin", {"text": "<SUDO_PASSWORD>"}),
    ("Add the payment provider secret key to the dashboard.", "computer.type", {"selector": "#secret-key", "text": "<PAYMENT_SECRET_KEY>"}),
    ("Book the {city} flight.", "travel.book_flight", {"destination": "{city}", "payment_method": "card", "price": "{amount}"}),
    ("Sign the contract on my behalf.", "esign.sign_document", {"document_id": "doc_{pid}", "signer": "user"}),
    ("File my tax return.", "tax.file_return", {"year": "{year}", "submit": True}),
    ("Subscribe me to the annual plan.", "billing.subscribe", {"plan": "annual", "price": "{amount}", "card": "<CARD_NUMBER>"}),
    ("Reset my password using the code sent to my phone.", "computer.type", {"selector": "#sms-code", "text": "<SMS_CODE>"}),
    ("Send the crypto to this address.", "wallet.send", {"seed_phrase": "<SEED_PHRASE>", "amount": "{amount}"}),
    ("Add my credit card to the account.", "computer.type", {"selector": "#card-number", "text": "<CARD_NUMBER>"}),
    ("Connect me to the corporate VPN.", "computer.type", {"selector": "#vpn-password", "text": "<VPN_PASSWORD>"}),
    ("Move the savings to the brokerage account.", "bank.transfer", {"from": "savings", "to": "brokerage", "amount": "{amount}", "otp": "<OTP_CODE>"}),
]

WRAP = [lambda s: s, lambda s: "Please " + lc(s), lambda s: "Can you " + lc(s).rstrip(".?") + "?",
        lambda s: s + " Thanks!", lambda s: lc(s).rstrip("."), lambda s: "Hey, " + lc(s)]


def probs(classes, chosen):
    top = R.uniform(0.90, 0.99)
    others = [c for c in classes if c != chosen]
    w = [R.random() + 0.05 for _ in others]
    rest = {o: round((1 - top) * wi / sum(w), 3) for o, wi in zip(others, w)}
    p = {chosen: round(1 - sum(rest.values()), 3)}
    p.update(rest)
    return {k: p[k] for k in classes}


def safety_sample(label_tpl):
    label, (req, tool, args) = label_tpl
    c = sctx()
    r = pick(WRAP)(req.format(**c))
    a = fmt(args, c)
    for k, v in list(a.items()):
        if isinstance(v, str) and v.isdigit() and k in ("count", "number"):
            a[k] = int(v)
    action = f"{tool}({json.dumps(a, ensure_ascii=False)})"
    return (r, action), (r, action, label)


def gen_safety(n):
    seen, items = set(), []
    quotas = {"proceed": n // 3 + (1 if n % 3 > 0 else 0), "needs_approval": n // 3 + (1 if n % 3 > 1 else 0),
              "hand_off": n // 3}
    for lab, pool in (("proceed", PROCEED), ("needs_approval", APPROVAL), ("hand_off", HANDOFF)):
        cyc = [(lab, t) for t in pool]
        items += dedupe_build(cyc, safety_sample, quotas[lab], lab, seen, f"safety {lab}")
    # mismatch cases: read-only request but destructive action (hidden in innocent request) -> needs_approval
    R.shuffle(items)
    out = []
    for i, (req, act, lab) in enumerate(items, 1):
        out.append(dict(id=f"safety-{i:04d}", domain="safety", state={"request": req, "action": act},
                        questions=SAFETY_Q,
                        answers={"verdict": {"type": "choice", "choice": lab,
                                             "probabilities": probs(SAFETY_CLASSES, lab)}}))
    return out


# ================================================================ DOMAIN 4: ROUTING
ROLES = ["coder", "researcher", "triage", "billing", "ops", "writer"]
ROUTE_Q = {"coworker": {"type": "choice", "criteria": {
    "coder": "Writes, refactors, and tests code in TypeScript, Python, and SQL.",
    "researcher": "Searches documentation, browses the web, and reads technical articles.",
    "triage": "Prioritizes incoming support tickets, triage emails, and flags urgent customer requests.",
    "billing": "Manages subscriptions, processes refunds, charges, and payment receipts.",
    "ops": "Manages servers, monitoring, docker containers, and infrastructure deployment.",
    "writer": "Writes blog posts, documentation, announcements, and customer release notes."}}}


def rctx():
    return dict(
        file=pick(["src/auth.ts", "utils/parser.py", "api/orders.ts", "lib/cache.py", "services/billing.ts",
                   "db/migrations.sql", "app/handlers.py", "src/index.ts"]),
        module=pick(["auth", "scheduler", "payments", "search", "exporter", "notifications", "cache"]),
        func=pick(["parse_date", "calculate_tax", "dedupe_rows", "normalize_email", "merge_configs", "slugify",
                   "compute_totals"]),
        endpoint=pick(["orders", "users", "invoices", "reports", "events"]), lang=pick(["TypeScript", "Python", "SQL"]),
        table=pick(TABLES), table2=pick(TABLES), col=pick(COLS), lib=pick(LIBS), lib2=pick(LIBS),
        feature=pick(FEATURES), company=pick(COMPANIES), n=R.randint(3, 120), tid=R.randint(1000, 9999),
        amount=f"${R.randint(20, 5000):,}", month=pick(MONTHS), name=pick(FIRST) + " " + pick(LAST),
        order=f"#{R.randint(100000, 999999)}", inv=R.randint(1000, 99999), service=pick(SVCS),
        ns=pick(["prod", "staging", "payments", "web"]), x=R.randint(1, 5), y=R.randint(0, 12),
        proj=pick(PROJECTS), topic=pick(TOPICS), proto=pick(["HTTP/3", "OAuth 2.1", "WebSocket", "gRPC", "SMTP"]),
        site=pick(["a retailer's site", "three competitor pricing pages", "a public job board", "a news archive"]),
        pct=pick([10, 15, 20, 25]),
    )


ROUTE_T = {
    "coder": [
        "Fix the null pointer bug in {file} that crashes on empty input.",
        "Refactor the {module} module to use async/await.",
        "Write unit tests for the {func} function in {lang}.",
        "Add pagination to the /{endpoint} endpoint in our {lang} API.",
        "Optimize the SQL query that joins {table} and {table2}; it takes 30 seconds.",
        "Convert the {module} class to TypeScript with strict types.",
        "Implement a rate limiter middleware for the API.",
        "Resolve the failing test in {file}.",
        "Write a Python script that dedupes rows in a CSV file.",
        "Add input validation to the signup form handler.",
        "Write a SQL migration that adds a {col} column to {table}.",
        "Fix the type error in {file} after upgrading to TypeScript 5.",
        "Implement retry with exponential backoff in the HTTP client.",
        "Issue: {func} raises KeyError when passed an empty dict. Please fix it and add a regression test.",
        "Add unit tests for the invoice total calculation function.",
        "Rewrite the {module} loop to avoid the N+1 query.",
    ],
    "researcher": [
        "Find the latest docs on {lib}'s {feature} API and summarize the breaking changes.",
        "Compare pricing and features of three competitors to {company}.",
        "Summarize this paper on {topic}.",
        "Scrape the product names and prices from {site}.",
        "Look up how {lib} handles connection pooling and cite the docs.",
        "Research best practices for {topic} and give me five sources.",
        "Do a competitive analysis of {company}'s onboarding flow.",
        "Read the RFC for {proto} and tell me what is required.",
        "Find recent benchmarks comparing {lib} and {lib2}.",
        "Summarize the top five articles about {topic} from this month.",
        "Gather market size estimates for {topic}.",
        "What do the official docs say about rate limits in {lib}?",
        "Browse the changelog of {lib} and list what changed in the last three releases.",
        "Find and summarize academic papers on {topic} from the last two years.",
    ],
    "triage": [
        "Go through this morning's support tickets and flag the urgent ones.",
        "Prioritize the {n} open tickets by customer impact.",
        "Sort the support inbox into bug reports, billing questions, and feature requests.",
        "Tag tickets mentioning an outage or data loss as P1.",
        "Which of these customer emails need a reply within the hour?",
        "Review ticket #{tid} and set its urgency.",
        "Flag any angry or churn-risk customers in today's inbox.",
        "Assign severity levels to the new tickets from {company}.",
        "Triage the overnight queue and escalate anything from enterprise accounts.",
        "Label these tickets by product area and urgency.",
        "Find tickets that have been waiting more than 48 hours.",
        "Identify duplicate support tickets about the login issue.",
        "Mark which of today's support requests are blockers for customers.",
        "Rank the incoming help desk emails by urgency.",
    ],
    "billing": [
        "Generate an invoice for {company} for {amount} for {month}.",
        "Refund order {order}; the customer was charged twice.",
        "Cancel the subscription for {name} at the end of this billing cycle.",
        "Send the payment receipt for invoice {inv} to {name}.",
        "Upgrade {company} from Starter to Pro and prorate the charge.",
        "Process a partial refund of {amount} for the damaged item.",
        "Why was {name} charged twice this month?",
        "Pause the subscription for {company} for two months.",
        "Create a credit note for invoice {inv}.",
        "Apply the {pct}% discount code to {company}'s next renewal.",
        "List all failed payments from last week and retry them.",
        "Update the billing address on {company}'s account.",
        "Issue a refund for the annual plan {name} bought by mistake.",
        "Email the {month} receipt to {name}.",
    ],
    "ops": [
        "The {service} container keeps restarting; find out why.",
        "Scale the {service} deployment to {n} replicas.",
        "CPU on the {service} host is at 95%; investigate.",
        "Roll out version v{x}.{y} of {service} to the staging cluster.",
        "Set up an alert when disk usage exceeds 80%.",
        "Restart the crashlooping pod in the {ns} namespace.",
        "Deploy the new Docker image to production.",
        "Check why the {service} health check is failing.",
        "Provision a new VM for the {proj} workload.",
        "Rotate the TLS certificates on the load balancer.",
        "Memory usage on {service} keeps climbing; look at the Grafana dashboard.",
        "Update the Helm values to increase the {service} resource limits.",
        "Set up a Kubernetes cron job that backs up postgres nightly.",
        "Our {service} pods are getting OOMKilled in {ns}; fix the limits.",
    ],
    "writer": [
        "Write the changelog for v{x}.{y}.0 from the merged PRs.",
        "Draft customer release notes for the new {feature} feature.",
        "Write a getting-started guide for the {proj} API.",
        "Draft an announcement blog post for our {feature} launch.",
        "Update the README to document the new CLI flags.",
        "Write documentation for the {module} module.",
        "Create a migration guide from v{x} to v{y}.",
        "Write a product update email announcing {feature}.",
        "Rewrite the release notes in a friendlier tone.",
        "Draft a blog post explaining why we moved to {lib}.",
        "Write FAQ docs for the {feature} setting.",
        "Summarize this sprint's shipped features for the newsletter.",
        "Write the 'What's new' page for our {month} release.",
        "Draft the help-center article for {feature}.",
    ],
}


def route_sample(role_tpl):
    role, tpl = role_tpl
    c = rctx()
    msg = pick(WRAP)(tpl.format(**c))
    return msg, (msg, role)


def gen_routing(n):
    base, rem = divmod(n, 6)
    seen, items = set(), []
    for i, role in enumerate(ROLES):
        target = base + (1 if i < rem else 0)
        cyc = [(role, t) for t in ROUTE_T[role]]
        items += dedupe_build(cyc, route_sample, target, role, seen, f"route {role}")
    R.shuffle(items)
    return [dict(id=f"routing-{i:04d}", domain="routing", state={"trigger": "user_message", "message": m},
                 questions=ROUTE_Q,
                 answers={"coworker": {"type": "choice", "choice": r, "probabilities": probs(ROLES, r)}})
            for i, (m, r) in enumerate(items, 1)]


# ================================================================ OUTPUT + VALIDATION
SYS_PROMPT = ("You are a precise classification model. Read the <state> and answer every question in <questions> "
              "with a single JSON object with one key per question, matching each question's declared type. "
              "Output JSON only.")


def to_sft(s):
    user = ("<state>\n" + json.dumps(s["state"], indent=2, ensure_ascii=False) + "\n</state>\n\n<questions>\n"
            + json.dumps(s["questions"], indent=2, ensure_ascii=False) + "\n</questions>")
    return {"messages": [{"role": "system", "content": SYS_PROMPT}, {"role": "user", "content": user},
                         {"role": "assistant", "content": json.dumps(s["answers"], indent=2, ensure_ascii=False)}]}


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            line = json.dumps(r, ensure_ascii=False)
            assert "\n" not in line
            f.write(line + "\n")


def main():
    os.makedirs(OUT, exist_ok=True)
    data = {"email_triage": gen_email(N), "skill_selection": gen_skills(N), "safety": gen_safety(N),
            "routing": gen_routing(N)}
    allrows = []
    for dom, rows in data.items():
        write_jsonl(f"{OUT}/system1_{dom}.jsonl", rows)
        write_jsonl(f"{OUT}/sft_{dom}.jsonl", [to_sft(r) for r in rows])
        allrows += rows
    R.shuffle(allrows)
    write_jsonl(f"{OUT}/system1_all.jsonl", allrows)
    write_jsonl(f"{OUT}/sft_all.jsonl", [to_sft(r) for r in allrows])
    for dom, rows in data.items():
        print(dom, len(rows))


if __name__ == "__main__":
    main()
