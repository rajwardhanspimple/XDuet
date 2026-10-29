import { DeciderInferenceEngine } from "../server/src/decision/inference";
import { readFile } from "node:fs/promises";

interface ParsedEmail {
  id: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  body: string;
}

function parseEmailText(rawText: string, idx: number): ParsedEmail {
  const fromMatch = rawText.match(/From:\s*([^\n\r]+)/i);
  const toMatch = rawText.match(/To:\s*([^\n\r]+)/i);
  const dateMatch = rawText.match(/Date:\s*([^\n\r]+)/i);
  const subjectMatch = rawText.match(/Subject:\s*([^\n\r]+)/i);

  const from = fromMatch ? fromMatch[1].trim() : "Unknown";
  const to = toMatch ? toMatch[1].trim() : "Unknown";
  const date = dateMatch ? dateMatch[1].trim() : "Unknown";
  const subject = subjectMatch ? subjectMatch[1].trim() : "No Subject";

  // Body is everything after the header block
  const lines = rawText.split("\n");
  const bodyStartIndex = lines.findIndex((l) =>
    /^(UNCLASSIFIED|RELEASE IN PART|Dear|Hi|Please|Attached|FYI)/i.test(
      l.trim(),
    ),
  );
  const body =
    bodyStartIndex !== -1
      ? lines.slice(bodyStartIndex).join("\n").trim()
      : rawText.slice(0, 500).trim();

  return {
    id: `wikileaks-hrc-${String(idx).padStart(4, "0")}`,
    from,
    to,
    date,
    subject,
    body: body.slice(0, 1500), // Keep reasonable context
  };
}

async function main() {
  console.log(
    "Downloading sample from Hugging Face WikiLeaks dataset (from-our-page/hillary-clinton-emails-wikileaks-jsonl)...",
  );
  const url =
    "https://huggingface.co/datasets/from-our-page/hillary-clinton-emails-wikileaks-jsonl/resolve/main/train.jsonl";

  // Download ~500KB chunk
  const res = await fetch(url, { headers: { Range: "bytes=0-524288" } });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Failed to fetch dataset: ${res.status} ${res.statusText}`);
  }

  const rawChunk = await res.text();
  const rawLines = rawChunk.split("\n").filter((l) => l.trim().startsWith("{"));
  console.log(
    `Downloaded chunk containing ${rawLines.length} raw email records.\n`,
  );

  const parsedEmails: ParsedEmail[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    try {
      const obj = JSON.parse(rawLines[i]);
      if (obj.text) {
        parsedEmails.push(parseEmailText(obj.text, i + 1));
      }
    } catch {
      // ignore trailing partial line
    }
  }

  console.log(`Parsed ${parsedEmails.length} structured emails.\n`);

  const nanoWeights = JSON.parse(
    await readFile("models/opendecider-nano/weights.json", "utf8"),
  );
  const engine = new DeciderInferenceEngine(nanoWeights);

  const results: {
    email: ParsedEmail;
    prob: number;
    decision: "NEEDS_YOU" | "CAN_WAIT";
    reason: string;
  }[] = [];

  for (const em of parsedEmails) {
    const state = {
      subject: em.subject,
      body: em.body,
      headers: {
        From: em.from,
        To: em.to,
        Date: em.date,
      },
    };

    const pred = engine.predict(state, {
      needs_you: {
        type: "noul",
        instructions: "Does this email require direct action today?",
      },
    });

    const prob = pred.needs_you.noul;
    const isUrgent = prob >= 0.5;

    let reason = "Informational / background diplomatic memo / news digest";
    if (isUrgent) {
      if (
        /today|urgent|immediate|call|approve|sign|before/i.test(
          em.subject + " " + em.body,
        )
      ) {
        reason = "Direct actionable request / urgent decision needed";
      } else {
        reason = "High-priority action item";
      }
    } else {
      if (
        /press|clips|fyi|daily activity|schedule|report/i.test(
          em.subject + " " + em.body,
        )
      ) {
        reason = "News clip / diplomatic briefing / routine readout";
      }
    }

    results.push({
      email: em,
      prob,
      decision: isUrgent ? "NEEDS_YOU" : "CAN_WAIT",
      reason,
    });
  }

  console.log("SAMPLE PREDICTIONS ON WIKILEAKS DUMP:");
  console.log(
    "================================================================================",
  );

  const urgentList = results.filter((r) => r.decision === "NEEDS_YOU");
  const canWaitList = results.filter((r) => r.decision === "CAN_WAIT");

  console.log(
    `\n--- URGENT ACTION REQUIRED (NEEDS_YOU: ${urgentList.length} emails) ---`,
  );
  for (const r of urgentList.slice(0, 10)) {
    console.log(
      `[P=${r.prob.toFixed(2)}] [${r.email.from}] -> Subj: "${r.email.subject.slice(0, 50)}"`,
    );
    console.log(
      `    Snippet: ${r.email.body.replace(/\s+/g, " ").slice(0, 100)}...`,
    );
  }

  console.log(
    `\n--- CAN WAIT / INFORMATIONAL (CAN_WAIT: ${canWaitList.length} emails) ---`,
  );
  for (const r of canWaitList.slice(0, 10)) {
    console.log(
      `[P=${r.prob.toFixed(2)}] [${r.email.from}] -> Subj: "${r.email.subject.slice(0, 50)}"`,
    );
    console.log(
      `    Snippet: ${r.email.body.replace(/\s+/g, " ").slice(0, 100)}...`,
    );
  }

  console.log(
    "\n================================================================================",
  );
  console.log(`TOTAL EVALUATED: ${results.length} WikiLeaks emails`);
  console.log(
    `  - Needs You (Actionable Today): ${urgentList.length} (${((urgentList.length / results.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  - Can Wait (Informational / Readouts): ${canWaitList.length} (${((canWaitList.length / results.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    "================================================================================",
  );
}

main().catch(console.error);
