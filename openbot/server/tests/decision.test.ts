import { describe, expect, test } from "bun:test";
import { createDecisionClient } from "../src/decision/client";
import { decisionConfigFromEnvironment } from "../src/decision/config";
import { createDecisionReviewer } from "../src/decision/safety";
import { createDecisionToolSelector } from "../src/decision/tool-selection";
import type { DecisionAnswers, DecisionClient } from "../src/decision/types";

const skills = [
  {
    slug: "weather",
    title: "Weather",
    summary: "Current conditions for a city.",
    tools: ["weather"],
  },
  {
    slug: "calendar",
    title: "Calendar",
    summary: "Meetings and events.",
    tools: ["calendar"],
  },
] as never;

function clientReturning(answers: DecisionAnswers): DecisionClient {
  return {
    provider: "fake",
    model: "fake",
    decide: async () => answers,
  };
}

function clientThrowing(): DecisionClient {
  return {
    provider: "fake",
    model: "fake",
    decide: async () => {
      throw new Error("no decision");
    },
  };
}

function reviewPrompt(
  action: Record<string, unknown>,
  request: string,
): string {
  return [
    "<request>",
    request,
    "</request>",
    "<action>",
    JSON.stringify(action, null, 2),
    "</action>",
  ].join("\n");
}

describe("decision configuration", () => {
  test("no provider means the features are off", () => {
    expect(decisionConfigFromEnvironment({})).toBeUndefined();
  });

  test("mercury-3 reuses the main OpenAI key and base URL", () => {
    const config = decisionConfigFromEnvironment({
      DECISION_PROVIDER: "mercury-3",
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://api.inceptionlabs.ai/v1/",
    });
    expect(config).toMatchObject({
      provider: "mercury-3",
      model: "mercury-3",
      apiKey: "sk-test",
      baseUrl: "https://api.inceptionlabs.ai/v1",
    });
  });

  test("mercury-decide refuses to boot without its own key", () => {
    expect(() =>
      decisionConfigFromEnvironment({
        DECISION_PROVIDER: "mercury-decide",
        OPENAI_API_KEY: "sk-test",
      }),
    ).toThrow("DECISION_API_KEY");
  });

  test("a local provider defaults to a local endpoint", () => {
    const config = decisionConfigFromEnvironment({
      DECISION_PROVIDER: "opendecider",
    });
    expect(config).toMatchObject({
      provider: "opendecider",
      baseUrl: "http://localhost:8000",
      model: "opendecider-nano",
    });
  });
});

describe("decision-backed tool selection", () => {
  test("chooses the skills over the threshold", async () => {
    const select = createDecisionToolSelector(
      clientReturning({
        "skill:weather": { type: "noul", noul: 0.91 },
        "skill:calendar": { type: "noul", noul: 0.05 },
      }),
      0.35,
    );
    await expect(select({ text: "weather in Paris", skills })).resolves.toEqual(
      ["weather"],
    );
  });

  test("no skill over the threshold offers everything", async () => {
    const select = createDecisionToolSelector(
      clientReturning({
        "skill:weather": { type: "noul", noul: 0.2 },
        "skill:calendar": { type: "noul", noul: 0.1 },
      }),
      0.35,
    );
    await expect(
      select({ text: "something else", skills }),
    ).resolves.toBeNull();
  });

  test("a failed decision offers everything", async () => {
    const select = createDecisionToolSelector(clientThrowing(), 0.35);
    await expect(
      select({ text: "weather in Paris", skills }),
    ).resolves.toBeNull();
  });
});

describe("decision-backed safety review", () => {
  test("a read that was explicitly requested proceeds", async () => {
    const review = createDecisionReviewer(
      clientReturning({
        verdict: {
          type: "choice",
          choice: "proceed",
          probabilities: { proceed: 0.95 },
          confidence: 0.95,
        },
        pre_approved: { type: "noul", noul: 0.95 },
        safety: {
          type: "choice",
          choice: "none",
          probabilities: { none: 0.95 },
          confidence: 0.95,
        },
        beyond_request: { type: "noul", noul: 0.02 },
        external_share: { type: "noul", noul: 0.01 },
        irreversible: { type: "noul", noul: 0.01 },
      }),
      0.5,
    );
    const verdict = JSON.parse(
      await review(
        reviewPrompt(
          { tool: "weather", effect: "read", target: "Paris" },
          "What is the weather in Paris?",
        ),
      ),
    );
    expect(verdict).toMatchObject({
      verdict: "proceed",
      preApproved: true,
      safety: "none",
    });
  });

  test("a credential change is handed to the person", async () => {
    const review = createDecisionReviewer(
      clientReturning({
        verdict: {
          type: "choice",
          choice: "hand_off",
          probabilities: { hand_off: 0.9 },
          confidence: 0.9,
        },
        pre_approved: { type: "noul", noul: 0.9 },
        safety: {
          type: "choice",
          choice: "credentials",
          probabilities: { credentials: 0.9 },
          confidence: 0.9,
        },
      }),
      0.5,
    );
    const verdict = JSON.parse(
      await review(
        reviewPrompt(
          { tool: "update_password", effect: "write", target: "account" },
          "Change my password to hunter2.",
        ),
      ),
    );
    expect(verdict).toMatchObject({
      verdict: "hand_off",
      safety: "credentials",
    });
  });

  test("an action beyond the request needs approval", async () => {
    const review = createDecisionReviewer(
      clientReturning({
        verdict: {
          type: "choice",
          choice: "proceed",
          probabilities: { proceed: 0.8 },
          confidence: 0.8,
        },
        pre_approved: { type: "noul", noul: 0.1 },
        safety: {
          type: "choice",
          choice: "none",
          probabilities: { none: 0.8 },
          confidence: 0.8,
        },
        beyond_request: { type: "noul", noul: 0.9 },
      }),
      0.5,
    );
    const verdict = JSON.parse(
      await review(
        reviewPrompt(
          { tool: "delete_account", effect: "write", target: "account" },
          "What is the weather in Paris?",
        ),
      ),
    );
    expect(verdict.verdict).toBe("needs_approval");
  });

  test("a prompt without an action fails closed", async () => {
    const review = createDecisionReviewer(
      clientReturning({
        verdict: {
          type: "choice",
          choice: "proceed",
          probabilities: { proceed: 0.9 },
          confidence: 0.9,
        },
      }),
      0.5,
    );
    await expect(review("not a review prompt")).rejects.toThrow(
      "request and action",
    );
  });
});

describe("decision client construction", () => {
  test("the provider is carried onto the client", () => {
    const config = decisionConfigFromEnvironment({
      DECISION_PROVIDER: "laya",
      DECISION_BASE_URL: "http://localhost:9000",
    });
    if (!config) throw new Error("expected a configuration");
    const client = createDecisionClient(config);
    expect(client.provider).toBe("laya");
    expect(client.model).toBe("laya");
  });
});
