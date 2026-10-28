#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readDecisionAuditEntries,
  updateDecisionSupervision,
  getDecisionAuditStats,
  recordDecisionAudit,
  type DecisionAuditEntry,
  type SupervisionStatus,
} from "../server/src/decision/audit";
import { createDecisionClient } from "../server/src/decision/client";
import { decisionConfigFromEnvironment } from "../server/src/decision/config";

const root = join(import.meta.dir, "..");
const goldenSeedsPath = join(root, "data", "golden-seeds.jsonl");

function printHelp() {
  console.log(`
OpenDuet Decision Supervision & Continuous Active Learning CLI
==============================================================

Commands:
  stats                                      Show summary statistics of all recorded decisions
  list [--status pending|approved|corrected] List recorded decisions (default: limit 20)
       [--domain triage|safety|routing|...]
       [--limit <number>]
  show <decision_id>                         Inspect full details of a specific decision
  approve <decision_id> [--note "<text>"]     Approve a decision as correct
  correct <decision_id> [options]            Correct a decision and append to golden seeds
       --choice <verdict>                    For choice questions (e.g. proceed, needs_approval, hand_off, coder, ops)
       --noul <0|1>                          For noul questions (0 or 1)
       --note "<text>"                       Optional supervisor explanation note
       --retrain                             Automatically retrain deciders immediately
  test-record                                Run a sample decision through the engine to verify recording
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "stats") {
    const stats = await getDecisionAuditStats();
    console.log(`
================================================================================
DECISION AUDIT & SUPERVISION SUMMARY
================================================================================
Total Recorded Decisions:  ${stats.total}
Average Decision Latency:  ${stats.avgLatencyMs} ms

Supervision Status:
  - Pending Review:        ${stats.byStatus.pending}
  - Approved:              ${stats.byStatus.approved}
  - Corrected:             ${stats.byStatus.corrected}

Breakdown by Domain:`);
    for (const [dom, cnt] of Object.entries(stats.byDomain)) {
      console.log(`  - ${dom.padEnd(16)}: ${cnt}`);
    }
    console.log(`\nBreakdown by Model:`);
    for (const [m, cnt] of Object.entries(stats.byModel)) {
      console.log(`  - ${m.padEnd(20)}: ${cnt}`);
    }
    console.log(`================================================================================\n`);
    return;
  }

  if (command === "list") {
    const statusIdx = args.indexOf("--status");
    const statusFilter = statusIdx !== -1 ? args[statusIdx + 1] : undefined;

    const domainIdx = args.indexOf("--domain");
    const domainFilter = domainIdx !== -1 ? args[domainIdx + 1] : undefined;

    const limitIdx = args.indexOf("--limit");
    const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) || 20 : 20;

    let entries = await readDecisionAuditEntries();
    if (statusFilter) entries = entries.filter((e) => e.supervision.status === statusFilter);
    if (domainFilter) entries = entries.filter((e) => e.domain === domainFilter);

    console.log(`\nShowing ${Math.min(limit, entries.length)} of ${entries.length} recorded decisions:\n`);
    console.log(
      `${"ID".padEnd(26)} | ${"DOMAIN".padEnd(14)} | ${"VERDICT / ANSWER".padEnd(22)} | ${"CONF".padEnd(6)} | ${"LATENCY".padEnd(8)} | ${"STATUS"}`
    );
    console.log("-".repeat(95));

    for (const e of entries.slice(-limit).reverse()) {
      let verdictStr = "-";
      let confStr = "-";
      for (const [qid, ans] of Object.entries(e.answers as Record<string, any>)) {
        if (ans?.type === "choice") {
          verdictStr = `${qid}:${ans.choice}`;
          confStr = `${(ans.confidence * 100).toFixed(0)}%`;
        } else if (ans?.type === "noul") {
          verdictStr = `${qid}:${ans.noul >= 0.5 ? 1 : 0} (p=${ans.noul})`;
          confStr = `${(Math.max(ans.noul, 1 - ans.noul) * 100).toFixed(0)}%`;
        }
      }
      const statusIcon =
        e.supervision.status === "approved"
          ? "[APPROVED]"
          : e.supervision.status === "corrected"
          ? "[CORRECTED]"
          : "[PENDING]";

      const latStr = e.latencyMs != null ? `${e.latencyMs.toFixed(2)}ms` : "-";
      console.log(
        `${e.id.padEnd(26)} | ${e.domain.padEnd(14)} | ${verdictStr.slice(0, 22).padEnd(22)} | ${confStr.padEnd(6)} | ${latStr.padEnd(8)} | ${statusIcon}`
      );
    }
    console.log("");
    return;
  }

  if (command === "show") {
    const id = args[1];
    if (!id) {
      console.error("Error: Please provide a decision ID. Example: bun scripts/supervise-decisions.ts show <id>");
      process.exit(1);
    }
    const entries = await readDecisionAuditEntries();
    const target = entries.find((e) => e.id === id);
    if (!target) {
      console.error(`Error: Decision with ID "${id}" not found.`);
      process.exit(1);
    }
    console.log(JSON.stringify(target, null, 2));
    return;
  }

  if (command === "approve") {
    const id = args[1];
    if (!id) {
      console.error("Error: Please provide a decision ID. Example: bun scripts/supervise-decisions.ts approve <id>");
      process.exit(1);
    }
    const noteIdx = args.indexOf("--note") !== -1 ? args.indexOf("--note") : args.indexOf("--notes");
    const note = noteIdx !== -1 ? args[noteIdx + 1] : undefined;

    const updated = await updateDecisionSupervision(id, {
      status: "approved",
      notes: note,
      reviewedBy: "supervisor",
    });

    if (!updated) {
      console.error(`Error: Decision with ID "${id}" not found.`);
      process.exit(1);
    }
    console.log(`[OK] Decision "${id}" has been marked as APPROVED.`);
    return;
  }

  if (command === "correct") {
    const id = args[1];
    if (!id) {
      console.error("Error: Please provide a decision ID. Example: bun scripts/supervise-decisions.ts correct <id> --choice <verdict>");
      process.exit(1);
    }

    const choiceIdx = args.indexOf("--choice");
    const choiceVal = choiceIdx !== -1 ? args[choiceIdx + 1] : undefined;

    const noulIdx = args.indexOf("--noul");
    const noulVal = noulIdx !== -1 ? Number(args[noulIdx + 1]) : undefined;

    const noteIdx = args.indexOf("--note") !== -1 ? args.indexOf("--note") : args.indexOf("--notes");
    const note = noteIdx !== -1 ? args[noteIdx + 1] : undefined;

    const retrainFlag = args.includes("--retrain");

    if (choiceVal === undefined && noulVal === undefined) {
      console.error("Error: Please specify either --choice <value> or --noul <0|1>.");
      process.exit(1);
    }

    const entries = await readDecisionAuditEntries();
    const target = entries.find((e) => e.id === id);
    if (!target) {
      console.error(`Error: Decision with ID "${id}" not found.`);
      process.exit(1);
    }

    const correctedAnswers: Record<string, any> = {};
    for (const [qid, q] of Object.entries(target.questions)) {
      if (q.type === "choice" && choiceVal !== undefined) {
        correctedAnswers[qid] = { type: "choice", choice: choiceVal };
      } else if (q.type === "noul" && noulVal !== undefined) {
        correctedAnswers[qid] = { type: "noul", noul: noulVal };
      }
    }

    const updated = await updateDecisionSupervision(id, {
      status: "corrected",
      correctedAnswers,
      notes: note,
      reviewedBy: "supervisor",
    });

    console.log(`[OK] Decision "${id}" marked as CORRECTED with answers:`, JSON.stringify(correctedAnswers));

    // Append to golden seeds
    const newSeed = {
      id: `seed_${id}`,
      domain: target.domain,
      state: target.state,
      questions: target.questions,
      answers: correctedAnswers,
      meta: {
        supervisedAt: new Date().toISOString(),
        supervisorNote: note || "Supervisor correction",
      },
    };

    const fs = await import("node:fs/promises");
    await fs.appendFile(goldenSeedsPath, JSON.stringify(newSeed) + "\n", "utf8");
    console.log(`[OK] Corrected sample appended to golden seeds (${goldenSeedsPath}).`);

    if (retrainFlag) {
      console.log(`[TRAIN] Launching decider retraining pipeline...`);
      const { spawnSync } = await import("node:child_process");
      const res = spawnSync("bun", ["run", "train:deciders"], { stdio: "inherit", cwd: root });
      if (res.status === 0) {
        console.log(`[OK] Decider models retrained with updated weights!`);
      } else {
        console.error(`[FAIL] Retraining failed with exit code ${res.status}`);
      }
    } else {
      console.log(`[TIP] Run 'bun run train:deciders' to update model weights with this correction.`);
    }
    return;
  }

  if (command === "test-record") {
    console.log("[TEST] Testing in-process decider client with audit recording...");
    const config = decisionConfigFromEnvironment(process.env);
    if (!config) {
      console.error("Error: No decision config found in environment.");
      process.exit(1);
    }

    const client = createDecisionClient(config);
    console.log(`Client created: provider=${client.provider}, model=${client.model}`);

    const testState = {
      request: "Check disk usage of root filesystem",
      action: "df -h /",
    };
    const testQuestions = {
      verdict: {
        type: "choice" as const,
        criteria: {
          proceed: "Safe to proceed automatically",
          needs_approval: "Requires human review",
          hand_off: "Sensitive credential handling",
        },
      },
    };

    const res = await client.decide(testState, testQuestions);
    console.log("[OK] Prediction result:", JSON.stringify(res, null, 2));

    await new Promise((resolve) => setTimeout(resolve, 150));

    const stats = await getDecisionAuditStats();
    console.log(`[OK] Verified! Total decisions now logged in audit store: ${stats.total}`);
    return;
  }

  printHelp();
}

void main();
