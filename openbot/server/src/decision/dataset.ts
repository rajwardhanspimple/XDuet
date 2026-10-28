import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DecisionAnswers, DecisionQuestion } from "./types";

export type DecisionDatasetEntry = {
  timestamp: string;
  provider: string;
  model: string;
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  answers: DecisionAnswers;
};

/**
 * Append a live decision result to a JSONL dataset file.
 * Non-blocking and never throws: failure to log training data must not fail the turn.
 */
export async function logDecisionDataset(
  filePath: string,
  entry: DecisionDatasetEntry,
): Promise<void> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    await appendFile(filePath, line, "utf8");
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "decision_dataset_log_error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Format raw logged decisions into instruction-tuning (SFT) conversation format:
 * {"messages": [{"role": "system", "content": ...}, {"role": "user", "content": ...}, {"role": "assistant", "content": ...}]}
 */
export function formatEntryForSFT(entry: DecisionDatasetEntry): {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
} {
  const systemPrompt =
    "You are a precise classification model, not a conversational assistant. Return a single JSON object containing exact answers for every question id.";
  const userContent = [
    "<state>",
    JSON.stringify(entry.state, null, 2),
    "</state>",
    "",
    "<questions>",
    JSON.stringify(entry.questions, null, 2),
    "</questions>",
  ].join("\n");
  const assistantContent = JSON.stringify(entry.answers, null, 2);

  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
      { role: "assistant", content: assistantContent },
    ],
  };
}

/**
 * Format raw logged decisions into SystemOne / OpenDecider JSON format:
 * {"state": ..., "questions": ..., "answers": ...}
 */
export function formatEntryForSystemOne(entry: DecisionDatasetEntry): {
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  answers: DecisionAnswers;
} {
  return {
    state: entry.state,
    questions: entry.questions,
    answers: entry.answers,
  };
}

