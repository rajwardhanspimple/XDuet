import { describe, expect, test } from "bun:test";
import { createLocalLearningRuntime } from "../src/learning/runtime";

describe("local learning runtime", () => {
  test("acquires learned skills catalog and executes load and read tools", async () => {
    const skills = [
      {
        slug: "browser-demo",
        title: "Browser Demo Skill",
        summary: "Navigates to internal portal and takes snapshot",
        instructions: "1. Navigate to portal. 2. Click submit button.",
      },
    ];

    const runtime = createLocalLearningRuntime({
      listSkillsForAgent: async (agentId) => {
        expect(agentId).toBe("agent-1");
        return skills;
      },
      readSkillFile: async (slug, path) => {
        if (slug === "browser-demo" && path === "guide.txt") {
          return "Detailed guide text";
        }
        throw new Error("File not found");
      },
    });

    const invocation = await runtime.acquire("agent-1");
    expect(invocation).toBeDefined();
    expect(invocation?.catalog).toContain('<skill name="browser-demo">');
    expect(invocation?.catalog).toContain(
      "<description>Navigates to internal portal and takes snapshot</description>",
    );

    expect(invocation?.tools.map((t) => t.name)).toEqual([
      "copilotkit_load_skill",
      "copilotkit_read_skill_file",
    ]);

    // Test copilotkit_load_skill tool execution
    const loaded = await invocation?.execute("copilotkit_load_skill", {
      skill_name: "browser-demo",
    });
    expect(loaded).toBe("1. Navigate to portal. 2. Click submit button.");

    // Test copilotkit_read_skill_file tool execution
    const fileContent = await invocation?.execute("copilotkit_read_skill_file", {
      skill_name: "browser-demo",
      path: "guide.txt",
    });
    expect(fileContent).toBe("Detailed guide text");

    // Status returns configured: true and initialized: true
    const status = await runtime.status();
    expect(status.configured).toBe(true);
    expect(status.initialized).toBe(true);
  });

  test("returns undefined when no skills are granted to the agent", async () => {
    const runtime = createLocalLearningRuntime({
      listSkillsForAgent: async () => [],
    });

    const invocation = await runtime.acquire("agent-2");
    expect(invocation).toBeUndefined();
  });
});
