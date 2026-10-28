import type {
  ChoiceAnswer,
  DecisionAnswer,
  DecisionAnswers,
  DecisionQuestion,
  NoulAnswer,
  ScoreAnswer,
} from "./types";

export type TrainedWeights = {
  modelName: string;
  version: string;
  trainedAt: string;
  totalTrainingSamples: number;
  // Per-task feature weights mapping token/n-gram to log-odds adjustment
  triageWeights: {
    bias: number;
    tokens: Record<string, number>;
  };
  safetyWeights: {
    bias: Record<string, number>;
    categories: Record<string, string[]>;
    tokens: Record<string, Record<string, number>>;
  };
  toolWeights: {
    bias: number;
    skills: Record<string, { keywords: string[]; bias: number; negativeKeywords?: string[] }>;
  };
  routingWeights: {
    bias: Record<string, number>;
    keywords: Record<string, string[]>;
  };
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-15, Math.min(15, z))));
}

function softmax(scores: Record<string, number>): Record<string, number> {
  const keys = Object.keys(scores);
  if (keys.length === 0) return {};
  const maxScore = Math.max(...Object.values(scores));
  const exps: Record<string, number> = {};
  let sum = 0;
  for (const k of keys) {
    const e = Math.exp(scores[k] - maxScore);
    exps[k] = e;
    sum += e;
  }
  const result: Record<string, number> = {};
  for (const k of keys) {
    result[k] = sum > 0 ? Number((exps[k] / sum).toFixed(4)) : 1 / keys.length;
  }
  return result;
}

export class DeciderInferenceEngine {
  constructor(private readonly weights: TrainedWeights) {}

  predict(state: unknown, questions: Record<string, DecisionQuestion>): DecisionAnswers {
    const answers: DecisionAnswers = {};
    const stateStr = typeof state === "string" ? state : JSON.stringify(state);
    const tokens = new Set(tokenize(stateStr));

    for (const [qid, question] of Object.entries(questions)) {
      if (question.type === "noul") {
        answers[qid] = this.predictNoul(qid, state, tokens, question);
      } else if (question.type === "choice") {
        answers[qid] = this.predictChoice(qid, state, tokens, question);
      } else if (question.type === "score") {
        answers[qid] = this.predictScore(qid, state, tokens, question);
      }
    }
    return answers;
  }

  private predictNoul(
    qid: string,
    state: unknown,
    tokens: Set<string>,
    _question: Extract<DecisionQuestion, { type: "noul" }>,
  ): NoulAnswer {
    // 1. Triage task (needs_you)
    if (qid === "needs_you" || qid === "urgent" || qid === "action_needed") {
      let score = this.weights.triageWeights.bias;
      const stateLower = (typeof state === "string" ? state : JSON.stringify(state)).toLowerCase();
      for (const [token, weight] of Object.entries(this.weights.triageWeights.tokens)) {
        if (token.includes(" ") ? stateLower.includes(token) : tokens.has(token)) {
          score += weight;
        }
      }
      const prob = Number(sigmoid(score).toFixed(4));
      return { type: "noul", noul: prob };
    }

    // 2. Tool selection question (e.g. skill slug)
    const skillConfig = this.weights.toolWeights.skills[qid];
    if (skillConfig) {
      let score = this.weights.toolWeights.bias + skillConfig.bias;
      const stateLower = (typeof state === "string" ? state : JSON.stringify(state)).toLowerCase();
      for (const kw of skillConfig.keywords) {
        const kwLower = kw.toLowerCase();
        if (kwLower.includes(" ") ? stateLower.includes(kwLower) : tokens.has(kwLower)) {
          score += 3.5;
        }
      }
      for (const nkw of skillConfig.negativeKeywords ?? []) {
        const nkwLower = nkw.toLowerCase();
        if (nkwLower.includes(" ") ? stateLower.includes(nkwLower) : tokens.has(nkwLower)) {
          score -= 5.0;
        }
      }
      const prob = Number(sigmoid(score).toFixed(4));
      return { type: "noul", noul: prob };
    }

    // 3. Safety sub-questions (pre_approved, beyond_request)
    if (qid === "beyond_request") {
      const isUnrelated = tokens.has("delete") || tokens.has("drop") || tokens.has("secret");
      return { type: "noul", noul: isUnrelated ? 0.9 : 0.1 };
    }
    if (qid === "pre_approved") {
      const explicit = tokens.has("please") || tokens.has("confirm") || tokens.has("execute");
      return { type: "noul", noul: explicit ? 0.85 : 0.2 };
    }

    // Default neutral
    let logOdds = 0;
    for (const token of tokens) {
      if (this.weights.triageWeights.tokens[token]) {
        logOdds += this.weights.triageWeights.tokens[token] * 0.5;
      }
    }
    return { type: "noul", noul: Number(sigmoid(logOdds).toFixed(4)) };
  }

  private predictChoice(
    qid: string,
    state: unknown,
    tokens: Set<string>,
    question: Extract<DecisionQuestion, { type: "choice" }>,
  ): ChoiceAnswer {
    const criteriaKeys = Object.keys(question.criteria);
    const rawScores: Record<string, number> = {};

    for (const key of criteriaKeys) {
      rawScores[key] = 0;
    }

    // 1. Safety verdict choice: proceed / needs_approval / hand_off
    if (qid === "verdict" && criteriaKeys.includes("proceed")) {
      const stateLower = (typeof state === "string" ? state : JSON.stringify(state)).toLowerCase();
      let handOffScore = this.weights.safetyWeights.bias?.hand_off ?? 0;
      let approvalScore = this.weights.safetyWeights.bias?.needs_approval ?? 0;
      let proceedScore = this.weights.safetyWeights.bias?.proceed ?? 1.0;

      const tokenWeights = this.weights.safetyWeights.tokens;
      if (tokenWeights) {
        for (const [kw, w] of Object.entries(tokenWeights.hand_off ?? {})) {
          if (kw.includes(" ") ? stateLower.includes(kw) : tokens.has(kw)) handOffScore += w;
        }
        for (const [kw, w] of Object.entries(tokenWeights.needs_approval ?? {})) {
          if (kw.includes(" ") ? stateLower.includes(kw) : tokens.has(kw)) approvalScore += w;
        }
        for (const [kw, w] of Object.entries(tokenWeights.proceed ?? {})) {
          if (kw.includes(" ") ? stateLower.includes(kw) : tokens.has(kw)) proceedScore += w;
        }
      } else {
        for (const kw of ["password", "secret", "card", "credential", "billing", "token", "payment", "bank"]) {
          if (tokens.has(kw)) handOffScore += 4.0;
        }
        for (const kw of ["delete", "drop", "overwrite", "transfer", "destroy", "restart", "revoke"]) {
          if (tokens.has(kw)) approvalScore += 3.0;
        }
        for (const kw of ["read", "get", "status", "list", "check", "view", "find", "snapshot"]) {
          if (tokens.has(kw)) proceedScore += 2.0;
        }
      }

      rawScores["hand_off"] = handOffScore;
      rawScores["needs_approval"] = approvalScore;
      rawScores["proceed"] = proceedScore;

      const probs = softmax(rawScores);
      let bestChoice = "proceed";
      let highestProb = -1;
      for (const [k, p] of Object.entries(probs)) {
        if (p > highestProb) {
          highestProb = p;
          bestChoice = k;
        }
      }
      return {
        type: "choice",
        choice: bestChoice,
        probabilities: probs,
        confidence: highestProb,
      };
    }

    // 2. Safety category choice: none / credentials / security_settings / payments
    if (qid === "safety" && criteriaKeys.includes("credentials")) {
      rawScores["none"] = 1.0;
      for (const [cat, words] of Object.entries(this.weights.safetyWeights.categories)) {
        for (const w of words) {
          if (tokens.has(w)) rawScores[cat] = (rawScores[cat] ?? 0) + 3.5;
        }
      }
      const probs = softmax(rawScores);
      let bestChoice = "none";
      let maxP = -1;
      for (const [k, p] of Object.entries(probs)) {
        if (p > maxP) {
          maxP = p;
          bestChoice = k;
        }
      }
      return {
        type: "choice",
        choice: bestChoice,
        probabilities: probs,
        confidence: maxP,
      };
    }

    // 3. Routing / Coworker choice
    const stateLower = (typeof state === "string" ? state : JSON.stringify(state)).toLowerCase();
    const routingKeywords = this.weights.routingWeights.keywords ?? {};

    for (const key of criteriaKeys) {
      const desc = question.criteria[key] ?? "";
      const descTokens = tokenize(desc);
      let score = (this.weights.routingWeights.bias[key] ?? 0);

      // Match criteria description tokens
      for (const dt of descTokens) {
        if (tokens.has(dt)) score += 1.0;
      }

      // Match learned routing keywords and phrases
      const kws = routingKeywords[key] ?? [];
      for (const kw of kws) {
        const kwLower = kw.toLowerCase();
        if (kwLower.includes(" ") ? stateLower.includes(kwLower) : tokens.has(kwLower)) {
          score += 3.5;
        }
      }

      rawScores[key] = score;
    }

    const probs = softmax(rawScores);
    let bestChoice = criteriaKeys[0];
    let maxConfidence = -1;
    for (const [k, p] of Object.entries(probs)) {
      if (p > maxConfidence) {
        maxConfidence = p;
        bestChoice = k;
      }
    }
    return {
      type: "choice",
      choice: bestChoice,
      probabilities: probs,
      confidence: maxConfidence,
    };
  }

  private predictScore(
    _qid: string,
    _state: unknown,
    tokens: Set<string>,
    question: Extract<DecisionQuestion, { type: "score" }>,
  ): ScoreAnswer {
    const numLevels = question.criteria.length;
    let urgencyScore = 0.2; // default low

    if (tokens.has("urgent") || tokens.has("asap") || tokens.has("today") || tokens.has("failed") || tokens.has("outage")) {
      urgencyScore = 0.88;
    } else if (tokens.has("soon") || tokens.has("review") || tokens.has("confirm") || tokens.has("friday")) {
      urgencyScore = 0.65;
    }

    const level = Math.min(numLevels - 1, Math.floor(urgencyScore * numLevels));
    const rawScores: Record<string, number> = {};
    for (let i = 0; i < numLevels; i++) {
      rawScores[String(i)] = -Math.abs(i - level * 1.5);
    }
    const probs = softmax(rawScores);

    return {
      type: "score",
      score: Number(urgencyScore.toFixed(3)),
      level,
      probabilities: probs,
      confidence: probs[String(level)] ?? 0.7,
    };
  }
}

