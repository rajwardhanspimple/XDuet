#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DeciderInferenceEngine,
  type TrainedWeights,
} from "../server/src/decision/inference";

async function main() {
  const root = join(import.meta.dir, "..");
  const weights: TrainedWeights = JSON.parse(
    await readFile(
      join(root, "models", "opendecider-nano", "weights.json"),
      "utf8",
    ),
  );
  const engine = new DeciderInferenceEngine(weights);

  const raw = await readFile(join(root, "data", "golden-seeds.jsonl"), "utf8");
  const samples = raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  let correct = 0;
  const domainStats: Record<string, { correct: number; total: number }> = {};

  for (const s of samples) {
    const d = s.domain ?? "other";
    domainStats[d] = domainStats[d] ?? { correct: 0, total: 0 };
    domainStats[d].total += 1;

    const pred = engine.predict(s.state, s.questions);
    let isMatch = true;
    for (const [qid, exp] of Object.entries(s.answers as Record<string, any>)) {
      const act = pred[qid];
      if (!act) {
        isMatch = false;
        break;
      }
      if (exp.type === "noul") {
        const p = (act as { noul: number })?.noul >= 0.5 ? 1 : 0;
        if (p !== exp.noul) {
          isMatch = false;
          break;
        }
      } else if (exp.type === "choice") {
        if ((act as { choice: string })?.choice !== exp.choice) {
          isMatch = false;
          break;
        }
      }
    }

    if (isMatch) {
      correct += 1;
      domainStats[d].correct += 1;
    } else {
      console.log(
        `[MISMATCH] ${s.id} (${s.domain}): expected`,
        s.answers,
        "got",
        pred,
      );
    }
  }

  console.log(
    `\n================================================================================`,
  );
  console.log(
    `EVALUATION ON ALL ${samples.length} ADVERSARIAL GOLDEN SEED SAMPLES`,
  );
  console.log(
    `================================================================================`,
  );
  console.log(
    `Overall: ${correct} / ${samples.length} (${((correct / samples.length) * 100).toFixed(2)}%)\n`,
  );
  for (const [d, st] of Object.entries(domainStats)) {
    console.log(
      `  - ${d}: ${st.correct} / ${st.total} (${((st.correct / st.total) * 100).toFixed(2)}%)`,
    );
  }
}

void main();
