#!/usr/bin/env bun
/**
 * Benchmark Script: Head-to-Head Comparison (Rate-Controlled for Inception Labs API)
 * Mercury Decide (Inception API) vs. OpenDecider Nano (Local) vs. Laya (Local)
 *
 * Configured strictly for Mercury's rate limit (<= 1,000 req/min):
 * - Rate-limited dispatcher: ~12 requests/sec (~720 req/min, safe margin below 1,000/min).
 * - Automatic exponential backoff retry on HTTP 429.
 *
 * Evaluates:
 * 1. 205 Adversarial Golden Seeds (Edge cases, prompt injections, pseudo-urgency)
 * 2. 200 Real Multi-Domain Test Samples (50 triage, 50 tools, 50 safety, 50 routing)
 * Total: 405 test instances per decider engine.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDecisionClient } from "../server/src/decision/client";
import { decisionConfigFromEnvironment } from "../server/src/decision/config";
import {
  DeciderInferenceEngine,
  type TrainedWeights,
} from "../server/src/decision/inference";
import type {
  DecisionAnswers,
  DecisionQuestion,
} from "../server/src/decision/types";

interface BenchmarkSample {
  id: string;
  domain: string;
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  answers: Record<string, any>;
}

interface EngineResult {
  correct: number;
  total: number;
  latenciesMs: number[];
  domainStats: Record<string, { correct: number; total: number }>;
  adversarialCorrect: number;
  adversarialTotal: number;
  generalCorrect: number;
  generalTotal: number;
  errors: number;
  retries: number;
}

function initEngineResult(): EngineResult {
  return {
    correct: 0,
    total: 0,
    latenciesMs: [],
    domainStats: {},
    adversarialCorrect: 0,
    adversarialTotal: 0,
    generalCorrect: 0,
    generalTotal: 0,
    errors: 0,
    retries: 0,
  };
}

function evaluatePrediction(
  pred: DecisionAnswers,
  expectedAnswers: Record<string, any>,
): boolean {
  for (const [qid, exp] of Object.entries(expectedAnswers)) {
    const act = pred[qid];
    if (!act) return false;

    if (exp.type === "noul") {
      const actProb = (act as { noul: number })?.noul ?? 0;
      const actBinary = actProb >= 0.5 ? 1 : 0;
      const expBinary =
        typeof exp.noul === "number" ? (exp.noul >= 0.5 ? 1 : 0) : 0;
      if (actBinary !== expBinary) return false;
    } else if (exp.type === "choice") {
      const actChoice = (act as { choice: string })?.choice;
      const expChoice = exp.choice;
      if (actChoice !== expChoice) return false;
    }
  }
  return true;
}

function calculatePercentiles(latencies: number[]) {
  if (latencies.length === 0) return { mean: 0, p50: 0, p90: 0, p99: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (pct: number) =>
    sorted[
      Math.min(Math.floor(sorted.length * (pct / 100)), sorted.length - 1)
    ];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    mean: Number((sum / sorted.length).toFixed(2)),
    p50: Number(p(50).toFixed(2)),
    p90: Number(p(90).toFixed(2)),
    p99: Number(p(99).toFixed(2)),
  };
}

class TokenBucketRateLimiter {
  private lastTime = performance.now();
  private tokens: number;

  constructor(
    private readonly maxTokens: number,
    private readonly tokensPerSec: number,
  ) {
    this.tokens = maxTokens;
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = performance.now();
      const elapsed = (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.tokens = Math.min(
        this.maxTokens,
        this.tokens + elapsed * this.tokensPerSec,
      );

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      const waitMs = ((1 - this.tokens) / this.tokensPerSec) * 1000;
      await new Promise((r) => setTimeout(r, Math.max(10, Math.ceil(waitMs))));
    }
  }
}

async function main() {
  const root = join(import.meta.dir, "..");

  console.log(
    "================================================================================",
  );
  console.log(
    "DECIDER BENCHMARK: MERCURY DECIDE vs. OPENDECIDER NANO vs. LAYA",
  );
  console.log(
    "Rate-Paced for Mercury Limit (1,000 req/min -> target ~720 req/min)",
  );
  console.log(
    "================================================================================",
  );
  console.log("Loading datasets and model weights...");

  // 1. Load Local Model Weights
  const nanoWeights: TrainedWeights = JSON.parse(
    await readFile(
      join(root, "models", "opendecider-nano", "weights.json"),
      "utf8",
    ),
  );
  const layaWeights: TrainedWeights = JSON.parse(
    await readFile(join(root, "models", "laya", "weights.json"), "utf8"),
  );

  const nanoEngine = new DeciderInferenceEngine(nanoWeights);
  const layaEngine = new DeciderInferenceEngine(layaWeights);

  // 2. Initialize Mercury Decide Client
  const mercuryConfig = decisionConfigFromEnvironment({
    DECISION_PROVIDER: "mercury-decide",
    DECISION_BASE_URL: "https://api.inceptionlabs.ai/v1",
    DECISION_API_KEY:
      "sk_a6dbd8a8624aaa0d882edbaa6a9be5562edb41cace9432f1b0c75e2f0341dc7e",
    DECISION_MODEL: "mercury-decide",
    DECISION_TIMEOUT_MS: "12000",
  });
  if (!mercuryConfig)
    throw new Error("Could not construct Mercury Decide config");
  const mercuryClient = createDecisionClient(mercuryConfig);

  // 3. Load Test Data
  const goldenRaw = await readFile(
    join(root, "data", "golden-seeds.jsonl"),
    "utf8",
  );
  const goldenSeeds: BenchmarkSample[] = goldenRaw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const downloadsRaw = await readFile(
    join(root, "data", "downloads_dataset", "system1_all.jsonl"),
    "utf8",
  );
  const allDownloads: BenchmarkSample[] = downloadsRaw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const domainBuckets: Record<string, BenchmarkSample[]> = {};
  for (const row of allDownloads) {
    const d =
      row.domain === "email_triage"
        ? "triage"
        : row.domain === "skill_selection"
          ? "tools"
          : row.domain;
    domainBuckets[d] = domainBuckets[d] ?? [];
    if (domainBuckets[d].length < 50) {
      domainBuckets[d].push({ ...row, domain: d });
    }
  }
  const generalTestSet: BenchmarkSample[] = Object.values(domainBuckets).flat();

  const fullTestSet = [
    ...goldenSeeds.map((s) => ({ ...s, isAdversarial: true })),
    ...generalTestSet.map((s) => ({ ...s, isAdversarial: false })),
  ];

  console.log(`Loaded ${goldenSeeds.length} Adversarial Golden Seeds.`);
  console.log(`Loaded ${generalTestSet.length} General Domain Samples.`);
  console.log(
    `Total test instances to evaluate per engine: ${fullTestSet.length}\n`,
  );

  const results = {
    "Mercury Decide (API)": initEngineResult(),
    "OpenDecider Nano (Local)": initEngineResult(),
    "Laya (Local)": initEngineResult(),
  };

  function recordResult(
    engineName: keyof typeof results,
    sample: BenchmarkSample & { isAdversarial: boolean },
    pred: DecisionAnswers,
    durationMs: number,
  ) {
    const res = results[engineName];
    res.total += 1;
    res.latenciesMs.push(durationMs);

    const d = sample.domain;
    res.domainStats[d] = res.domainStats[d] ?? { correct: 0, total: 0 };
    res.domainStats[d].total += 1;

    if (sample.isAdversarial) res.adversarialTotal += 1;
    else res.generalTotal += 1;

    const isCorrect = evaluatePrediction(pred, sample.answers);
    if (isCorrect) {
      res.correct += 1;
      res.domainStats[d].correct += 1;
      if (sample.isAdversarial) res.adversarialCorrect += 1;
      else res.generalCorrect += 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Step 1: Benchmark OpenDecider Nano (Local)
  // ---------------------------------------------------------------------------
  console.log("[1/3] Benchmarking OpenDecider Nano (Local In-Memory)...");
  for (const sample of fullTestSet) {
    const start = performance.now();
    const pred = nanoEngine.predict(sample.state, sample.questions);
    const duration = performance.now() - start;
    recordResult("OpenDecider Nano (Local)", sample, pred, duration);
  }
  console.log(
    "      Completed in",
    results["OpenDecider Nano (Local)"].latenciesMs
      .reduce((a, b) => a + b, 0)
      .toFixed(1),
    "ms total CPU time.",
  );

  // ---------------------------------------------------------------------------
  // Step 2: Benchmark Laya (Local)
  // ---------------------------------------------------------------------------
  console.log("[2/3] Benchmarking Laya (Local In-Memory)...");
  for (const sample of fullTestSet) {
    const start = performance.now();
    const pred = layaEngine.predict(sample.state, sample.questions);
    const duration = performance.now() - start;
    recordResult("Laya (Local)", sample, pred, duration);
  }
  console.log(
    "      Completed in",
    results["Laya (Local)"].latenciesMs.reduce((a, b) => a + b, 0).toFixed(1),
    "ms total CPU time.",
  );

  // ---------------------------------------------------------------------------
  // Step 3: Benchmark Mercury Decide (Inception Cloud API) with Rate-Limiting & Backoff
  // ---------------------------------------------------------------------------
  console.log(
    "[3/3] Benchmarking Mercury Decide (Inception Labs Hosted API)...",
  );
  console.log(
    "      Rate Pacing: 12 requests/second (~720 req/min; ceiling is 1,000 req/min)",
  );
  console.log(
    "      Concurrency: 4 workers with Token Bucket rate limiter & 429 exponential backoff...",
  );

  const rateLimiter = new TokenBucketRateLimiter(6, 12); // Max burst 6, steady 12 req/sec
  let completedMercury = 0;
  const startMercuryTotal = performance.now();

  async function executeMercuryWithRetry(
    sample: BenchmarkSample & { isAdversarial: boolean },
  ) {
    const maxRetries = 4;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await rateLimiter.acquire();
      const start = performance.now();
      try {
        const pred = await mercuryClient.decide(sample.state, sample.questions);
        const duration = performance.now() - start;
        recordResult("Mercury Decide (API)", sample, pred, duration);
        return;
      } catch (err: any) {
        const duration = performance.now() - start;
        const msg = String(err?.message ?? "");
        const isRateLimit = msg.includes("429") || msg.includes("rate_limit");

        if (attempt < maxRetries && isRateLimit) {
          results["Mercury Decide (API)"].retries += 1;
          const backoffMs = 2000 * Math.pow(1.5, attempt);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        // On terminal failure
        const res = results["Mercury Decide (API)"];
        res.total += 1;
        res.errors += 1;
        res.latenciesMs.push(duration);
        const d = sample.domain;
        res.domainStats[d] = res.domainStats[d] ?? { correct: 0, total: 0 };
        res.domainStats[d].total += 1;
        if (sample.isAdversarial) res.adversarialTotal += 1;
        else res.generalTotal += 1;
        return;
      }
    }
  }

  // Run with 4 concurrent workers feeding from rate limiter
  let sampleIndex = 0;
  const workerCount = 4;
  const workers = Array.from({ length: workerCount }, async () => {
    while (sampleIndex < fullTestSet.length) {
      const idx = sampleIndex++;
      await executeMercuryWithRetry(fullTestSet[idx]);
      completedMercury++;
      if (
        completedMercury % 25 === 0 ||
        completedMercury === fullTestSet.length
      ) {
        const pct = ((completedMercury / fullTestSet.length) * 100).toFixed(0);
        process.stdout.write(
          `      Progress: ${completedMercury}/${fullTestSet.length} (${pct}%) [Retries: ${results["Mercury Decide (API)"].retries}, Errors: ${results["Mercury Decide (API)"].errors}]...\r`,
        );
      }
    }
  });

  await Promise.all(workers);

  const totalMercuryDuration = performance.now() - startMercuryTotal;
  console.log(
    `\n      Finished Mercury Decide in ${(totalMercuryDuration / 1000).toFixed(1)} seconds.`,
  );

  // ---------------------------------------------------------------------------
  // Generate Comprehensive Comparison Output
  // ---------------------------------------------------------------------------
  console.log(
    "\n================================================================================",
  );
  console.log("HEAD-TO-HEAD BENCHMARK RESULTS (EXACT MEASURED DATA)");
  console.log(
    "================================================================================\n",
  );

  const engines = [
    "Mercury Decide (API)",
    "OpenDecider Nano (Local)",
    "Laya (Local)",
  ] as const;

  console.log("1. OVERALL ACCURACY SUMMARY:");
  console.log(
    "--------------------------------------------------------------------------------",
  );
  console.log(
    "Engine".padEnd(26) +
      "Overall Acc".padEnd(18) +
      "Adversarial Seeds".padEnd(20) +
      "General Test Set".padEnd(18) +
      "Errors / Retries",
  );
  console.log(
    "--------------------------------------------------------------------------------",
  );

  for (const eng of engines) {
    const r = results[eng];
    const overallPct = `${r.correct}/${r.total} (${((r.correct / r.total) * 100).toFixed(2)}%)`;
    const advPct = `${r.adversarialCorrect}/${r.adversarialTotal} (${(
      (r.adversarialCorrect / r.adversarialTotal) * 100
    ).toFixed(2)}%)`;
    const genPct = `${r.generalCorrect}/${r.generalTotal} (${(
      (r.generalCorrect / r.generalTotal) * 100
    ).toFixed(2)}%)`;
    const errInfo = `${r.errors} err / ${r.retries} retries`;
    console.log(
      eng.padEnd(26) +
        overallPct.padEnd(18) +
        advPct.padEnd(20) +
        genPct.padEnd(18) +
        errInfo,
    );
  }

  console.log("\n2. DOMAIN BREAKDOWN ACCURACY:");
  console.log(
    "--------------------------------------------------------------------------------",
  );
  const allDomains = Array.from(
    new Set(engines.flatMap((e) => Object.keys(results[e].domainStats))),
  ).sort();

  console.log(
    "Engine".padEnd(26) + allDomains.map((d) => d.padEnd(14)).join(""),
  );
  console.log(
    "--------------------------------------------------------------------------------",
  );
  for (const eng of engines) {
    const r = results[eng];
    const domCols = allDomains.map((d) => {
      const st = r.domainStats[d];
      if (!st || st.total === 0) return "N/A".padEnd(14);
      return `${((st.correct / st.total) * 100).toFixed(1)}%`.padEnd(14);
    });
    console.log(eng.padEnd(26) + domCols.join(""));
  }

  console.log("\n3. LATENCY PERFORMANCE (MILLISECONDS):");
  console.log(
    "--------------------------------------------------------------------------------",
  );
  console.log(
    "Engine".padEnd(26) +
      "Mean Latency".padEnd(16) +
      "P50 (Median)".padEnd(16) +
      "P90".padEnd(14) +
      "P99".padEnd(14) +
      "Throughput",
  );
  console.log(
    "--------------------------------------------------------------------------------",
  );
  for (const eng of engines) {
    const lat = calculatePercentiles(results[eng].latenciesMs);
    const throughput =
      lat.mean > 0 ? `${(1000 / lat.mean).toFixed(0)} dec/s` : "N/A";
    console.log(
      eng.padEnd(26) +
        `${lat.mean} ms`.padEnd(16) +
        `${lat.p50} ms`.padEnd(16) +
        `${lat.p90} ms`.padEnd(14) +
        `${lat.p99} ms`.padEnd(14) +
        throughput,
    );
  }

  console.log(
    "\n================================================================================",
  );
}

void main();
