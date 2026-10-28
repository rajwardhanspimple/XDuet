import { describe, expect, test } from "bun:test";
import { localChannelTitle } from "../src/channels/local-title";

describe("local channel titles", () => {
  test("names the conversation after the question, not the answer", () => {
    expect(
      localChannelTitle(
        "Asked: Explain diffusion in one sentence. Answered: Diffusion is the process of reversing noise.",
      ),
    ).toBe("Explain diffusion in one sentence.");
  });

  test("accepts the excerpt before it is flattened to one line", () => {
    expect(
      localChannelTitle("Asked: Plan my week\nAnswered: Here is a plan."),
    ).toBe("Plan my week");
  });

  test("cuts a long question at a word boundary", () => {
    const title = localChannelTitle(
      `Asked: ${"word ".repeat(20).trim()} Answered: An answer.`,
    );
    expect(title?.endsWith("…")).toBe(true);
    expect(title?.length).toBe(60);
    expect(title).not.toContain("  ");
    expect(title).not.toContain("Answered");
  });

  test("has no title when nobody asked anything", () => {
    expect(localChannelTitle("")).toBeNull();
    expect(localChannelTitle("Answered: Only an answer.")).toBeNull();
  });
});
