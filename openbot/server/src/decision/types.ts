/**
 * Typed decisions, independent of who answers them.
 *
 * A decision is a fixed set of questions about one state: a yes/no, a choice between named
 * options, or a score. Keeping the shape here rather than in a provider client is what lets the
 * same tool-selection and safety questions run against Mercury 3 today, a local OpenDecider or
 * Laya server tomorrow, and Mercury Decide when a separate key is available.
 */

export type NoulQuestion = {
  type: "noul";
  instructions?: string;
  /** Optional labels for the two outcomes, for providers that use them. */
  true?: string;
  false?: string;
};

export type ChoiceQuestion = {
  type: "choice";
  instructions?: string;
  criteria: Record<string, string | null>;
};

export type ScoreQuestion = {
  type: "score";
  instructions?: string;
  criteria: string[];
};

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = {
  type: "noul";
  /** Probability the statement is true, 0..1. */
  noul: number;
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  /** Probability of the chosen option, 0..1. */
  confidence: number;
};

export type ScoreAnswer = {
  type: "score";
  score: number;
  /** Index into the question's criteria. */
  level: number;
  probabilities: Record<string, number>;
  confidence: number;
};

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type DecisionAnswers = Record<string, DecisionAnswer>;

export type DecisionClient = {
  readonly provider: string;
  readonly model: string;
  decide(
    state: unknown,
    questions: Record<string, DecisionQuestion>,
    signal?: AbortSignal,
  ): Promise<DecisionAnswers>;
};
