#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import {
  type DecisionDatasetEntry,
  formatEntryForSFT,
  formatEntryForSystemOne,
} from "../server/src/decision/dataset";

/**
 * Export and format logged decision interactions for training/fine-tuning custom
 * OpenDecider or Laya decision models.
 *
 * Usage:
 *   bun scripts/export-decision-dataset.ts [input.jsonl] [output.jsonl] [--format=sft|systemone]
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.info(`
Export Decision Dataset
=======================
Export and format logged decision records for training/fine-tuning custom
OpenDecider or Laya decision models.

Usage:
  bun scripts/export-decision-dataset.ts [input.jsonl] [output.jsonl] [--format=sft|systemone]

Options:
  --format=sft        OpenAI instruction-tuning conversation format (default)
  --format=systemone  Direct SystemOne / OpenDecider JSON format
  --help, -h          Show this help message
`);
    process.exit(0);
  }
  const positional = args.filter((a) => !a.startsWith("--"));

  const inputPath = positional[0] ?? "data/decisions.jsonl";
  const outputPath = positional[1] ?? "data/decisions-training.jsonl";
  const format =
    Array.from(flags)
      .find((f) => f.startsWith("--format="))
      ?.split("=")[1] ?? "sft";

  console.info(`[Dataset Export] Reading from: ${inputPath}`);
  let rawContent: string;
  try {
    rawContent = await readFile(inputPath, "utf8");
  } catch (err) {
    console.error(
      `Could not read input file ${inputPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const lines = rawContent.split("\n").filter((line) => line.trim().length > 0);
  console.info(`[Dataset Export] Found ${lines.length} decision records.`);

  const stats = {
    total: 0,
    providers: {} as Record<string, number>,
    models: {} as Record<string, number>,
    questionTypes: {} as Record<string, number>,
  };

  const outputLines: string[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as DecisionDatasetEntry;
      stats.total += 1;
      stats.providers[entry.provider] =
        (stats.providers[entry.provider] ?? 0) + 1;
      stats.models[entry.model] = (stats.models[entry.model] ?? 0) + 1;

      for (const q of Object.values(entry.questions ?? {})) {
        stats.questionTypes[q.type] = (stats.questionTypes[q.type] ?? 0) + 1;
      }

      if (format === "systemone") {
        outputLines.push(JSON.stringify(formatEntryForSystemOne(entry)));
      } else {
        outputLines.push(JSON.stringify(formatEntryForSFT(entry)));
      }
    } catch {
      // skip invalid line
    }
  }

  await writeFile(outputPath, outputLines.join("\n") + "\n", "utf8");

  console.info(`\n=== Export Summary ===`);
  console.info(`Total exported examples: ${stats.total}`);
  console.info(`Output format: ${format}`);
  console.info(`Output written to: ${outputPath}`);
  console.info(`Providers:`, stats.providers);
  console.info(`Models:`, stats.models);
  console.info(`Question Types:`, stats.questionTypes);
}

void main();
