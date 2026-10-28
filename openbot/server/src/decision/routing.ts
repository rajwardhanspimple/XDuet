import type { RoutingCandidate } from "../routing/classify";
import type { DecisionClient } from "./types";

export type DecisionRoutingAnswer = {
  agentId: string;
  confidence: number;
};

/**
 * Route an untagged message with the decision model rather than a prose completion.
 *
 * The question is a typed choice over the roster, not a JSON-shaped request to a chat model. Each
 * option carries the same role description the generative router used, plus the systems that
 * coworker can reach, so the decision sees the two facts that mattered: what someone is for, and
 * what they can actually get to.
 *
 * A malformed or off-roster answer is returned as-is and the routing service's normal fallback
 * handles it. This function only translates; it does not turn a decision into an authorization.
 */
export function createDecisionRouter(
  client: DecisionClient,
): (
  text: string,
  candidates: readonly RoutingCandidate[],
) => Promise<DecisionRoutingAnswer | null> {
  return async (text, candidates) => {
    const answers = await client.decide(
      { request: text, task: "route an untagged message to one coworker" },
      {
        coworker: {
          type: "choice",
          instructions:
            "Choose the one coworker whose purpose best fits the person's message. Prefer a specialist when it clearly fits; otherwise choose the most general coworker and report low confidence.",
          criteria: Object.fromEntries(
            candidates.map((candidate) => [
              candidate.id,
              [
                candidate.name,
                candidate.roleDescription,
                candidate.reaches && candidate.reaches.length > 0
                  ? `can reach: ${candidate.reaches.join(", ")}`
                  : null,
              ]
                .filter((part): part is string => Boolean(part))
                .join(" — "),
            ]),
          ),
        },
      },
    );

    const answer = answers.coworker;
    if (answer?.type !== "choice") return null;
    return {
      agentId: answer.choice,
      confidence: answer.confidence,
    };
  };
}
