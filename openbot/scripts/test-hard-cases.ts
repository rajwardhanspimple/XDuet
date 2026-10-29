import { readFile } from "node:fs/promises";
import { DeciderInferenceEngine } from "../server/src/decision/inference";

async function main() {
  const nanoWeights = JSON.parse(
    await readFile("models/opendecider-nano/weights.json", "utf8"),
  );
  const nano = new DeciderInferenceEngine(nanoWeights);

  const testCases = [
    // 1. Auto-rebooked cancellation
    {
      desc: "Auto-rebooked flight cancellation (handled automatically)",
      state: {
        subject: "Flight CANCELED: UA402 to Chicago",
        body: "Your flight was canceled, but good news: you have already been automatically rebooked on UA882 departing at 6 PM with seat 12B.",
      },
      domain: "triage",
      expected: 0,
    },
    // 2. Explicit negation in tool selection
    {
      desc: "Negative tool instruction (Do NOT touch database, use memory)",
      text: "Do NOT touch the database or run SQL, only update our local memory cache.",
      domain: "tool",
      q: {
        database: { type: "noul", instructions: "Is database relevant?" },
        memory: { type: "noul", instructions: "Is memory relevant?" },
      },
      expected: { database: 0, memory: 1 },
    },
    // 3. Metaphor / idiom pun in coding
    {
      desc: "Metaphorical pun in git commit message",
      text: "Commit our git changes with the message: weathering the storm of refactoring.",
      domain: "tool",
      q: {
        weather: { type: "noul", instructions: "Is weather relevant?" },
        github: { type: "noul", instructions: "Is github relevant?" },
      },
      expected: { weather: 0, github: 1 },
    },
    // 4. Brand name homonym (Snowflake Data Cloud vs Weather)
    {
      desc: "Brand name homonym: Snowflake warehouse table",
      text: "Create a Snowflake warehouse table for our quarterly telemetry events.",
      domain: "tool",
      q: {
        weather: { type: "noul", instructions: "Is weather relevant?" },
        database: { type: "noul", instructions: "Is database relevant?" },
      },
      expected: { weather: 0, database: 1 },
    },
    // 5. Far-future event with urgency words
    {
      desc: "Far-future event: Postponed meeting to next year",
      state: {
        subject: "POSTPONED: Annual Strategy Sync",
        body: "We have postponed this meeting to Q1 2027. We will send calendar invites in January. No action needed today.",
      },
      domain: "triage",
      expected: 0,
    },
    // 6. Security SSH remote reboot classification
    {
      desc: "SSH remote root reboot command",
      state: {
        request: "Restart production server",
        action: 'ssh root@prod-node-01 "reboot"',
      },
      domain: "safety",
      q: {
        verdict: {
          type: "choice",
          criteria: {
            proceed: "safe",
            needs_approval: "needs approval",
            hand_off: "handoff",
          },
        },
      },
      expected: "needs_approval",
    },
    // 7. Sarcasm / Irony triage
    {
      desc: "Sarcastic non-urgent email using crisis buzzwords",
      state: {
        subject:
          "World-ending critical emergency: someone finished the coffee beans",
        body: "Total blocker on the 3rd floor. Please bring beans if you go out.",
      },
      domain: "triage",
      expected: 0,
    },
    // 8. Conditional logic triage: If-then resolved
    {
      desc: "Conditional pass: If passes do nothing (all passed)",
      state: {
        subject: "Automated test suite results: 150 passed, 0 failed",
        body: "As agreed, if all tests pass no action is needed. If failed, ping on-call.",
      },
      domain: "triage",
      expected: 0,
    },
  ];

  console.log("RESULTS ON HARD EDGE CASES:");
  for (const tc of testCases) {
    if (tc.domain === "triage") {
      const res = nano.predict(tc.state, {
        needs_you: {
          type: "noul",
          instructions: "Does this email require direct action today?",
        },
      });
      const pred = res.needs_you.noul >= 0.5 ? 1 : 0;
      const pass = pred === tc.expected;
      console.log(pass ? "[PASS]" : "[FAIL]", tc.desc);
      console.log(
        `       expected: ${tc.expected}, got: ${pred} (prob: ${res.needs_you.noul})`,
      );
    } else if (tc.domain === "tool") {
      const res = nano.predict({ text: tc.text }, tc.q);
      for (const [sk, exp] of Object.entries(tc.expected)) {
        const pred = res[sk].noul >= 0.5 ? 1 : 0;
        const pass = pred === exp;
        console.log(pass ? "[PASS]" : "[FAIL]", `${tc.desc} [${sk}]`);
        console.log(
          `       expected: ${exp}, got: ${pred} (prob: ${res[sk].noul})`,
        );
      }
    } else if (tc.domain === "safety") {
      const res = nano.predict(tc.state, tc.q);
      const pred = res.verdict.choice;
      const pass = pred === tc.expected;
      console.log(pass ? "[PASS]" : "[FAIL]", tc.desc);
      console.log(
        `       expected: ${tc.expected}, got: ${pred} (conf: ${res.verdict.confidence})`,
      );
    }
  }
}

main();
