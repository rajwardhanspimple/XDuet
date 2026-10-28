import type { SelectableSkill } from "../plugins/selection";
import type { DecisionAnswers, DecisionClient } from "./types";

/**
 * Choose which skills a run needs, as one typed question per skill.
 *
 * The trade is deliberately asymmetric and matches the old selection prompt: a skill that is
 * offered unnecessarily costs a few tool definitions, while a skill that is missing means the run
 * cannot do the work at all. The threshold is therefore low, and every uncertain path returns
 * `null`, which the caller turns into "offer everything".
 */
export function createDecisionToolSelector(
  client: DecisionClient,
  threshold: number,
) {
  return async (input: {
    text: string;
    skills: readonly SelectableSkill[];
    signal?: AbortSignal;
  }): Promise<string[] | null> => {
    const { text, skills, signal } = input;
    if (text.trim() === "" || skills.length === 0) return null;
    // A decision over a catalogue this large is not a narrowing anymore; the prompt cost and the
    // chance of a malformed answer both outweigh the benefit. Fall back to the full catalogue.
    if (skills.length > 80) return null;

    const questions = Object.fromEntries(
      skills.map((skill) => [
        `skill:${skill.slug}`,
        {
          type: "noul" as const,
          instructions: [
            `Does this message need the "${skill.title}" capability?`,
            skill.summary,
            "Answer yes if it might be needed, even if you are unsure.",
          ]
            .filter(Boolean)
            .join(" "),
          true: "needed",
          false: "not needed",
        },
      ]),
    );

    let answers: DecisionAnswers;
    try {
      answers = await client.decide({ message: text }, questions, signal);
    } catch {
      signal?.throwIfAborted();
      return null;
    }
    signal?.throwIfAborted();

    const chosen = skills
      .filter((skill) => {
        const answer = answers[`skill:${skill.slug}`];
        return answer?.type === "noul" && answer.noul >= threshold;
      })
      .map((skill) => skill.slug);

    // No skill over the threshold is the same answer as no skill: offer everything rather than
    // risk removing the one tool the run needed.
    return chosen.length > 0 ? chosen : null;
  };
}
