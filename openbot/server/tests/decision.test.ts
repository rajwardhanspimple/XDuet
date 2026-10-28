import { describe, expect, test } from "bun:test";
import { createDecisionClient } from "../src/decision/client";
import { decisionConfigFromEnvironment } from "../src/decision/config";
import { createDecisionRouter } from "../src/decision/routing";
import { createDecisionReviewer } from "../src/decision/safety";
import { createDecisionToolSelector } from "../src/decision/tool-selection";
import { createDecisionTriage } from "../src/decision/triage";
import type { DecisionAnswers, DecisionClient } from "../src/decision/types";
import {
  TriageAnswerError,
  type TriageMessage,
  triage,
} from "../src/openduet/triage";
import { createIntentRouter } from "../src/routing/classify";

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

describe("decision-backed routing", () => {
  const candidates = [
    {
      id: "calendar",
      name: "Calendar",
      roleDescription: "Meetings, invitations and scheduling.",
      reaches: ["google-calendar"],
    },
    {
      id: "researcher",
      name: "Researcher",
      roleDescription: "Reads documents and answers questions.",
    },
  ] as const;

  test("the decision model picks a coworker and the router trusts it", async () => {
    const router = createIntentRouter({
      complete: async () => {
        throw new Error("the prose router must not be called");
      },
      decide: createDecisionRouter(
        clientReturning({
          coworker: {
            type: "choice",
            choice: "calendar",
            probabilities: { calendar: 0.9, researcher: 0.1 },
            confidence: 0.9,
          },
        }),
      ),
      minConfidence: 0.6,
    });

    await expect(
      router.route("move my 3pm to Thursday", candidates, "researcher"),
    ).resolves.toMatchObject({
      agentId: "calendar",
      name: "Calendar",
      fallback: false,
      undecided: null,
    });
  });

  test("a low-confidence decision falls back to the default", async () => {
    const router = createIntentRouter({
      complete: async () => {
        throw new Error("the prose router must not be called");
      },
      decide: createDecisionRouter(
        clientReturning({
          coworker: {
            type: "choice",
            choice: "calendar",
            probabilities: { calendar: 0.51, researcher: 0.49 },
            confidence: 0.51,
          },
        }),
      ),
      minConfidence: 0.6,
    });

    await expect(
      router.route("something ambiguous", candidates, "researcher"),
    ).resolves.toMatchObject({
      agentId: "researcher",
      fallback: true,
      undecided: "unconfident",
    });
  });

  test("an off-roster decision never acts on the named id", async () => {
    const router = createIntentRouter({
      complete: async () => {
        throw new Error("the prose router must not be called");
      },
      decide: createDecisionRouter(
        clientReturning({
          coworker: {
            type: "choice",
            choice: "removed-bot",
            probabilities: { "removed-bot": 0.99 },
            confidence: 0.99,
          },
        }),
      ),
    });

    await expect(
      router.route("anything", candidates, "researcher"),
    ).resolves.toMatchObject({
      agentId: "researcher",
      fallback: true,
      undecided: "off-roster",
    });
  });
});

describe("decision-backed triage", () => {
  const message: TriageMessage = {
    id: "m1",
    from: "Ada <ada@example.com>",
    to: ["dev@openbot.local"],
    cc: [],
    subject: "Can you approve the invoice before Friday?",
    date: "2026-10-28T09:00:00.000Z",
    headers: {},
    labels: [],
    body: "The payment run closes Friday. We need your approval.",
  };
  const person = {
    name: "Dev",
    email: "dev@openbot.local",
  };

  test("a confident decision becomes the verdict", async () => {
    const decide = createDecisionTriage(
      clientReturning({
        needs_you: { type: "noul", noul: 0.92 },
      }),
      0.5,
    );
    await expect(
      triage(message, person, {
        complete: async () => {
          throw new Error("the prose triage must not be called");
        },
        model: "mercury-3",
        decide,
      }),
    ).resolves.toMatchObject({
      verdict: "needs_you",
      decidedBy: "decision:fake",
    });
  });

  test("an uncertain decision is a failure, not a quiet can-wait", async () => {
    const decide = createDecisionTriage(
      clientReturning({
        needs_you: { type: "noul", noul: 0.55 },
      }),
      0.7,
    );
    await expect(
      triage(message, person, {
        complete: async () => {
          throw new Error("the prose triage must not be called");
        },
        model: "mercury-3",
        decide,
      }),
    ).rejects.toBeInstanceOf(TriageAnswerError);
  });

  test("an exactly undecided answer is a failure, even at the lowest threshold", async () => {
    const decide = createDecisionTriage(
      clientReturning({
        needs_you: { type: "noul", noul: 0.5 },
      }),
      0.5,
    );
    await expect(
      triage(message, person, {
        complete: async () => {
          throw new Error("the prose triage must not be called");
        },
        model: "mercury-3",
        decide,
      }),
    ).rejects.toBeInstanceOf(TriageAnswerError);
  });

  test("a rule still decides before the decision model is asked", async () => {
    const ruled: TriageMessage = {
      ...message,
      labels: ["CATEGORY_PROMOTIONS"],
      headers: { "List-Unsubscribe": "<https://example.com/unsub>" },
    };
    await expect(
      triage(ruled, person, {
        complete: async () => {
          throw new Error("the prose triage must not be called");
        },
        model: "mercury-3",
        decide: async () => {
          throw new Error("the decision model must not be called");
        },
      }),
    ).resolves.toMatchObject({ decidedBy: "rule:bulk", verdict: "can_wait" });
  });
});
