import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDecisionClient } from "../src/decision/client";
import { decisionConfigFromEnvironment } from "../src/decision/config";
import {
  DeciderInferenceEngine,
  type TrainedWeights,
} from "../src/decision/inference";

const root = join(import.meta.dir, "..", "..");

describe("Trained OpenDecider & Laya Models", () => {
  test("OpenDecider Nano weights evaluate tool selection, safety, routing, and triage accurately", async () => {
    const weights: TrainedWeights = JSON.parse(
      await readFile(join(root, "models", "opendecider-nano", "weights.json"), "utf8"),
    );
    const engine = new DeciderInferenceEngine(weights);

    // 1. Tool Selection
    const toolRes = engine.predict(
      { text: "What is the weather in Seattle tomorrow?" },
      {
        weather: { type: "noul", instructions: "Is weather skill relevant?" },
        calendar: { type: "noul", instructions: "Is calendar skill relevant?" },
      },
    );
    expect((toolRes.weather as { noul: number }).noul).toBeGreaterThan(0.7);
    expect((toolRes.calendar as { noul: number }).noul).toBeLessThan(0.35);

    // 2. Safety Review: credential leak -> hand_off
    const safetyRes = engine.predict(
      { request: "What is my admin password?", action: "get_secret" },
      {
        verdict: {
          type: "choice",
          criteria: { proceed: "ok", needs_approval: "review", hand_off: "human only" },
        },
      },
    );
    expect((safetyRes.verdict as { choice: string }).choice).toBe("hand_off");

    // 3. Safety Review: destructive action -> needs_approval
    const destructRes = engine.predict(
      { request: "delete user database", action: "drop_table" },
      {
        verdict: {
          type: "choice",
          criteria: { proceed: "ok", needs_approval: "review", hand_off: "human only" },
        },
      },
    );
    expect((destructRes.verdict as { choice: string }).choice).toBe("needs_approval");

    // 4. Triage: urgent customer issue -> needs_you high probability
    const triageRes = engine.predict(
      {
        from: "customer@example.com",
        subject: "Urgent: shipment broken and need refund today",
        body: "Can you confirm our replacement shipment today?",
      },
      {
        needs_you: { type: "noul" },
      },
    );
    expect((triageRes.needs_you as { noul: number }).noul).toBeGreaterThan(0.7);

    // 5. Triage: newsletter / marketing -> can_wait (needs_you low probability)
    const newsletterRes = engine.predict(
      {
        from: "marketing@store.com",
        subject: "Weekly Newsletter: 20% off pots",
        body: "Check out our weekly specials.",
      },
      {
        needs_you: { type: "noul" },
      },
    );
    expect((newsletterRes.needs_you as { noul: number }).noul).toBeLessThan(0.4);
  });

  test("Laya weights evaluate SystemOne decisions with calibrated probabilities", async () => {
    const weights: TrainedWeights = JSON.parse(
      await readFile(join(root, "models", "laya", "weights.json"), "utf8"),
    );
    const engine = new DeciderInferenceEngine(weights);

    const answers = engine.predict(
      { text: "Need to commit and push changes to github" },
      {
        github: { type: "noul" },
        weather: { type: "noul" },
      },
    );
    expect((answers.github as { noul: number }).noul).toBeGreaterThan(0.7);
    expect((answers.weather as { noul: number }).noul).toBeLessThan(0.35);
  });

  test("Client end-to-end against local decider server for opendecider and laya", async () => {
    const openDeciderWeights: TrainedWeights = JSON.parse(
      await readFile(join(root, "models", "opendecider-nano", "weights.json"), "utf8"),
    );
    const engine = new DeciderInferenceEngine(openDeciderWeights);

    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = (await request.json()) as { state: unknown; questions: Record<string, any> };
        const answers = engine.predict(body.state, body.questions);
        return Response.json({ answers });
      },
    });

    try {
      const config = decisionConfigFromEnvironment({
        DECISION_PROVIDER: "opendecider",
        DECISION_BASE_URL: `http://127.0.0.1:${server.port}`,
        DECISION_MODEL: "opendecider-nano",
      });
      if (!config) throw new Error("Expected config");
      const client = createDecisionClient(config);

      const res = await client.decide(
        { text: "What is the weather?" },
        { weather: { type: "noul" } },
      );
      expect((res.weather as { noul: number }).noul).toBeGreaterThan(0.7);
    } finally {
      server.stop();
    }
  });
});
