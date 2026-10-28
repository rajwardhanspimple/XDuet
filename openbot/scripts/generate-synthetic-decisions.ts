#!/usr/bin/env bun
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Synthetic Decision Data Generator
 *
 * Uses the active Mercury 3 generative model to synthesize hundreds or thousands of
 * diverse decision scenarios (edge-case emails, tool intents, safety prompts, and routing cases)
 * to expand the training dataset for OpenDecider and Laya to massive scale ("huge data training").
 *
 * Usage:
 *   bun scripts/generate-synthetic-decisions.ts [count] [output.jsonl]
 *   e.g.: bun scripts/generate-synthetic-decisions.ts 100 data/synthetic-decisions.jsonl
 */

const root = join(import.meta.dir, "..");
const count = Number(process.argv[2] ?? 50);
const outputPath = process.argv[3] ?? join(root, "data", "synthetic-decisions.jsonl");

const apiKey = process.env.OPENAI_API_KEY ?? process.env.DECISION_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.inceptionlabs.ai/v1";
const model = process.env.BOT_MODEL ?? "mercury-3";

if (!apiKey) {
  console.error("Error: OPENAI_API_KEY or DECISION_API_KEY is required in environment.");
  process.exit(1);
}

const DOMAINS = [
  "customer email needing urgent refund or cancellation",
  "marketing email with aggressive urgency language but no real action needed",
  "tool request asking to search files or git commit history",
  "dangerous shell command attempting to delete database or system files",
  "request to view or update personal credentials or passwords",
  "routine routing request asking to write code vs search web documentation",
];

async function callMercury(prompt: string): Promise<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a synthetic dataset generator for decision models. Emit strictly valid JSON objects, one per line (JSONL format), with no markdown formatting.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercury API error (${response.status}): ${text}`);
  }

  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

async function main() {
  console.info(`[Synthetic Generator] Generating ${count} decision examples using ${model}...`);
  await mkdir(join(root, "data"), { recursive: true });

  let generated = 0;
  const batchSize = Math.min(10, count);

  while (generated < count) {
    const domain = DOMAINS[generated % DOMAINS.length];
    const prompt = `Generate ${batchSize} diverse training examples for the domain "${domain}".
Each example must be a JSON object with this exact shape:
{
  "domain": "${domain}",
  "state": { "text": "description of user request or email" },
  "questions": { "target_question": { "type": "noul", "instructions": "yes/no check" } },
  "answers": { "target_question": { "type": "noul", "noul": 0.95 } }
}
Output only the raw JSON objects separated by newlines.`;

    try {
      const output = await callMercury(prompt);
      const lines = output
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{") && l.endsWith("}"));

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          await appendFile(outputPath, JSON.stringify(parsed) + "\n", "utf8");
          generated += 1;
          if (generated >= count) break;
        } catch {
          // skip malformed line
        }
      }
      console.info(`  Progress: ${generated}/${count} samples generated...`);
    } catch (err) {
      console.error(`  Batch failed: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }

  console.info(`\n[Synthetic Generator] Completed! Generated ${generated} samples into ${outputPath}`);
}

void main();

