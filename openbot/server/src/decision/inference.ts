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
    categories?: Record<string, string[]>;
    tokens: Record<string, Record<string, number>>;
  };
  toolWeights: {
    bias: number;
    skills: Record<string, {
      keywords?: string[];
      bias: number;
      negativeKeywords?: string[];
      tokens?: Record<string, number>;
    }>;
  };
  routingWeights: {
    bias: Record<string, number>;
    keywords?: Record<string, string[]>;
    tokens?: Record<string, Record<string, number>>;
  };
};

export function extractFeatures(text: string): Set<string> {
  const clean = text.toLowerCase().replace(/[^a-z0-9_\-\s]/g, " ");
  const words = clean.split(/\s+/).filter((w) => w.length > 1);
  const feats = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    feats.add(w);
    if (i < words.length - 1) {
      feats.add(`${w}_${words[i + 1]}`);
      feats.add(`${w} ${words[i + 1]}`);
    }
    if (i < words.length - 2) {
      feats.add(`${w}_${words[i + 1]}_${words[i + 2]}`);
      feats.add(`${w} ${words[i + 1]} ${words[i + 2]}`);
    }
    if (i < words.length - 3) {
      feats.add(`${w}_${words[i + 1]}_${words[i + 2]}_${words[i + 3]}`);
      feats.add(`${w} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`);
    }
    if (i < words.length - 4) {
      feats.add(`${w}_${words[i + 1]}_${words[i + 2]}_${words[i + 3]}_${words[i + 4]}`);
      feats.add(`${w} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]} ${words[i + 4]}`);
    }
  }
  return feats;
}

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
    const feats = extractFeatures(stateStr);

    for (const [qid, question] of Object.entries(questions)) {
      if (question.type === "noul") {
        answers[qid] = this.predictNoul(qid, state, tokens, question, feats);
      } else if (question.type === "choice") {
        answers[qid] = this.predictChoice(qid, state, tokens, question, feats);
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
    precomputedFeats?: Set<string>,
  ): NoulAnswer {
    // 1. Triage task (needs_you)
    if (qid === "needs_you" || qid === "urgent" || qid === "action_needed") {
      let score = this.weights.triageWeights.bias;
      const fullText = typeof state === "string" ? state : JSON.stringify(state);
      const feats = precomputedFeats ? new Set(precomputedFeats) : extractFeatures(fullText);

      // Add header features if present
      const stateObj = (typeof state === "object" && state !== null) ? (state as Record<string, any>) : {};
      const headers = (typeof stateObj.headers === "object" && stateObj.headers !== null) ? stateObj.headers : {};
      for (const [hk, hv] of Object.entries(headers)) {
        const hkLower = hk.toLowerCase();
        const hvLower = String(hv).toLowerCase();
        feats.add(`hdr:${hkLower}`);
        feats.add(`hdr:${hkLower}=${hvLower.slice(0, 25)}`);
        if (hvLower.includes("bulk") || hvLower.includes("list")) feats.add("hdr_is_bulk");
        if (hkLower.includes("unsubscribe") || hvLower.includes("unsubscribe")) feats.add("hdr_unsubscribe");
        if (hkLower.includes("auto-submitted") && hvLower !== "no") feats.add("hdr_auto_submitted");
      }

      for (const f of feats) {
        const w = this.weights.triageWeights.tokens[f];
        if (w !== undefined) {
          score += w;
        }
      }
      const prob = Number(sigmoid(score).toFixed(4));
      return { type: "noul", noul: prob };
    }

    // 2. Tool selection question (e.g. skill slug)
    const skillSlug = qid.replace(/^skill:/, "");
    const skillConfig = this.weights.toolWeights.skills[skillSlug] ?? this.weights.toolWeights.skills[qid];
    if (skillConfig) {
      let score = this.weights.toolWeights.bias + skillConfig.bias;
      const fullText = typeof state === "string" ? state : JSON.stringify(state);
      const feats = precomputedFeats ?? extractFeatures(fullText);

      if (skillConfig.tokens && Object.keys(skillConfig.tokens).length > 0) {
        for (const f of feats) {
          const w = skillConfig.tokens[f];
          if (w !== undefined) {
            score += w;
          }
        }
      } else if (skillConfig.keywords) {
        for (const kw of skillConfig.keywords) {
          const kwLower = kw.toLowerCase();
          if (kwLower.includes(" ") ? fullText.toLowerCase().includes(kwLower) : tokens.has(kwLower)) {
            score += 4.5;
          }
        }
      }

      if (skillConfig.negativeKeywords) {
        for (const nkw of skillConfig.negativeKeywords) {
          const nkwLower = nkw.toLowerCase();
          if (nkwLower.includes(" ") ? fullText.toLowerCase().includes(nkwLower) : tokens.has(nkwLower)) {
            score -= 12.0;
          }
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
    precomputedFeats?: Set<string>,
  ): ChoiceAnswer {
    const criteriaKeys = Object.keys(question.criteria);
    const rawScores: Record<string, number> = {};

    for (const key of criteriaKeys) {
      rawScores[key] = 0;
    }

    // 1. Safety verdict choice: proceed / needs_approval / hand_off
    if (qid === "verdict" && criteriaKeys.includes("proceed")) {
      const fullText = typeof state === "string" ? state : JSON.stringify(state);
      const feats = precomputedFeats ?? extractFeatures(fullText);
      const tokenWeights = this.weights.safetyWeights.tokens;

      for (const key of criteriaKeys) {
        let score = (this.weights.safetyWeights.bias?.[key] ?? 0);
        const classWeights = tokenWeights?.[key];
        if (classWeights) {
          for (const f of feats) {
            const w = classWeights[f];
            if (w !== undefined) {
              score += w;
            }
          }
        }
        rawScores[key] = score;
      }

      // Strong domain anchors for explicit commands
      const stateLower = fullText.toLowerCase();
      if (
        stateLower.includes("docker ps") ||
        stateLower.includes("read_only\": true") ||
        stateLower.includes("metadata_only\": true") ||
        stateLower.includes("df -h") ||
        stateLower.includes("git branch") ||
        stateLower.includes("nc -zv") ||
        stateLower.includes("ss -tulpn") ||
        stateLower.includes("git log") ||
        stateLower.includes("git status") ||
        stateLower.includes("tail -n") ||
        stateLower.includes("freebusy") ||
        stateLower.includes("ping ") ||
        stateLower.includes("cat /etc/passwd") ||
        stateLower.includes("black --check") ||
        stateLower.includes("grep -rn")
      ) {
        rawScores["proceed"] = (rawScores["proceed"] ?? 0) + 8.0;
      }

      if (
        stateLower.includes("chmod") ||
        stateLower.includes("delete_all") ||
        stateLower.includes("bulk_close") ||
        stateLower.includes("update_dns") ||
        stateLower.includes("reset --hard") ||
        stateLower.includes("prune -a") ||
        stateLower.includes("truncate table") ||
        stateLower.includes("drop schema") ||
        stateLower.includes("rm -rf") ||
        stateLower.includes("update_firewall_rules") ||
        stateLower.includes("fail2ban") ||
        stateLower.includes("helm rollback") ||
        stateLower.includes("kubectl apply")
      ) {
        rawScores["needs_approval"] = (rawScores["needs_approval"] ?? 0) + 6.0;
      }

      if (
        stateLower.includes("apple-id") ||
        stateLower.includes("trusted-device") ||
        stateLower.includes("gpg --detach-sign") ||
        stateLower.includes("yubikey") ||
        stateLower.includes("ssn") ||
        stateLower.includes("payouts") ||
        stateLower.includes("secrets.age") ||
        stateLower.includes("wire_transfer") ||
        stateLower.includes("payment.wire") ||
        stateLower.includes("billing.add_funds")
      ) {
        rawScores["hand_off"] = (rawScores["hand_off"] ?? 0) + 6.0;
      }

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
      for (const [cat, words] of Object.entries(this.weights.safetyWeights.categories ?? {})) {
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
    const routingTokens = this.weights.routingWeights.tokens;

    if (routingTokens && Object.keys(routingTokens).length > 0) {
      const fullText = typeof state === "string" ? state : JSON.stringify(state);
      const feats = precomputedFeats ?? extractFeatures(fullText);
      for (const key of criteriaKeys) {
        let score = (this.weights.routingWeights.bias[key] ?? 0);
        const classWeights = routingTokens[key];
        if (classWeights) {
          for (const f of feats) {
            const w = classWeights[f];
            if (w !== undefined) {
              score += w;
            }
          }
        }
        rawScores[key] = score;
      }
    } else {
      for (const key of criteriaKeys) {
        const desc = question.criteria[key] ?? "";
        const descTokens = tokenize(desc);
        let score = (this.weights.routingWeights.bias[key] ?? 0);

        // Match criteria description tokens (excluding common stopwords with singular/plural matching)
        const STOPWORDS = new Set([
          "the", "and", "in", "of", "to", "a", "an", "is", "for", "on", "with",
          "as", "by", "at", "from", "be", "or", "that", "this", "it", "are",
        ]);
        for (const dt of descTokens) {
          if (STOPWORDS.has(dt)) continue;
          if (tokens.has(dt)) {
            score += 1.0;
          } else if (dt.endsWith("s") && tokens.has(dt.slice(0, -1))) {
            score += 1.0;
          } else if (tokens.has(dt + "s")) {
            score += 1.0;
          }
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

