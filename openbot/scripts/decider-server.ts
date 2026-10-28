#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DeciderInferenceEngine,
  type TrainedWeights,
} from "../server/src/decision/inference";
import type { DecisionQuestion } from "../server/src/decision/types";

const root = join(import.meta.dir, "..");
const port = Number(process.env.DECISION_PORT ?? 8000);

async function main() {
  const openDeciderWeights: TrainedWeights = JSON.parse(
    await readFile(join(root, "models", "opendecider-nano", "weights.json"), "utf8"),
  );
  const layaWeights: TrainedWeights = JSON.parse(
    await readFile(join(root, "models", "laya", "weights.json"), "utf8"),
  );

  const openDeciderEngine = new DeciderInferenceEngine(openDeciderWeights);
  const layaEngine = new DeciderInferenceEngine(layaWeights);

  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/health" || url.pathname === "/v1/health") {
        return Response.json({
          status: "ok",
          models: ["opendecider-nano", "laya"],
          activeProviders: ["opendecider", "laya"],
        });
      }

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      let body: {
        model?: string;
        state?: unknown;
        questions?: Record<string, DecisionQuestion>;
      };
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }

      if (!body.questions) {
        return Response.json({ error: "Missing questions" }, { status: 400 });
      }

      // Check whether to use Laya or OpenDecider based on URL or model
      const isLaya =
        url.pathname.includes("systemone") ||
        body.model?.toLowerCase().includes("laya");

      const engine = isLaya ? layaEngine : openDeciderEngine;
      const model = isLaya ? "laya" : "opendecider-nano";

      const answers = engine.predict(body.state, body.questions);

      // SystemOne format or standard decisions format
      if (url.pathname.includes("systemone")) {
        return Response.json({
          model,
          results: answers,
          answers,
        });
      }

      return Response.json({
        model,
        answers,
      });
    },
  });

  console.info(`[Decider Server] Running on http://127.0.0.1:${server.port}`);
  console.info(`  - OpenDecider endpoint: http://127.0.0.1:${server.port}/v1/decisions`);
  console.info(`  - Laya endpoint:        http://127.0.0.1:${server.port}/v1/systemone`);
  console.info(`  - Health check:         http://127.0.0.1:${server.port}/health`);
}

void main();
