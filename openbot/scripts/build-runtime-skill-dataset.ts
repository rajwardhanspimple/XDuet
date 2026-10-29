/**
 * Training rows for the skills this deployment actually asks about.
 *
 * WHY. The decider's tool head was fitted over eight legacy labels — weather, calendar, email,
 * github, shell, computer, database, memory — and the runtime asks `skill:<slug>` questions for the
 * slugs in the `skills` table instead. The two vocabularies had no overlap at all, so every skill
 * question missed its weights entry and fell through to the same default. Tool selection was
 * running, answering, and choosing nothing.
 *
 * WHAT THIS WRITES. `data/tools/runtime-skills.jsonl`, in the shape `train-decider-models.ts`
 * already fits: one row per utterance, `answers[<slug>].noul` high for the skill it is about and
 * low for the others. Read the file to see what the model will be taught; it is the whole dataset.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The slugs granted to a Bot in this deployment, and what a person says when they mean it. */
const UTTERANCES: Record<string, readonly string[]> = {
  "browse-web": [
    "open wikipedia and read the page about the coelacanth",
    "browse to news.ycombinator.com and summarise the top stories",
    "search on wikipedia about cod",
    "i need you to browse search on wikipedia about cod",
    "navigate to the pricing page and tell me what the plans cost",
    "open this link in the browser and check the title",
    "go to the site and see whether the form works",
    "load the page and read me the first paragraph",
    "click through to the docs page and find the install steps",
    "open the dashboard in the browser and take a screenshot",
  ],
  "research-public-web": [
    "research the current state of solid state batteries and cite your sources",
    "find recent public sources on the EU AI act and write a cited brief",
    "compare published benchmarks for open models, with references",
    "do a literature scan on retrieval augmented generation evaluation",
    "gather public sources on competitor pricing and summarise with links",
    "what does the published research say about long context models, with citations",
    "collect web sources about the new export rules and cite them",
    "write a brief on the market for lab grown diamonds from public sources",
    "research and cite who is funding this startup",
    "survey public reporting on the merger and cite each claim",
  ],
  "find-a-document": [
    "find the Q3 contract in my drive",
    "search my documents for the onboarding checklist",
    "where is the signed NDA",
    "look through drive for the budget spreadsheet",
    "open the file that changed most recently in my drive",
    "find the doc that explains our refund policy",
    "which file has the vendor agreement",
    "search drive for anything about the reorganisation",
    "pull up the proposal deck from last quarter",
    "read the contract in my drive and tell me the notice period",
  ],
  "reply-to-an-email": [
    "reply to Sara's email about the invoice",
    "draft a reply to the last message from the vendor",
    "answer that email and say we will ship on Friday",
    "send a reply to the thread about the contract redlines",
    "reply to this email telling them we need two more days",
    "write back to the customer and confirm the refund",
    "respond to the recruiter and decline politely",
    "email them back with the updated schedule",
    "reply to the thread and attach nothing",
    "send a short answer to the last mail from finance",
  ],
  "morning-brief": [
    "what needs me today",
    "give me my morning brief",
    "what is on my plate today",
    "summarise what needs my attention today",
    "what can wait and what cannot, today",
    "catch me up on today before i start",
    "start my day with a brief",
    "anything urgent this morning",
    "what should i look at first today",
    "run my morning brief",
  ],
  "first-day": [
    "get to know me from my recent mail",
    "learn what i work on from this week's calendar",
    "set yourself up by reading my recent email",
    "read my recent mail so you know what i do",
    "figure out my role from my inbox and calendar",
    "look at my last week of mail and tell me what my job is",
    "onboard yourself from my calendar and inbox",
    "work out who i work with from recent email",
    "skim my recent messages and introduce yourself back",
    "learn my context from mail before we start",
  ],
  "skill-creator": [
    "write a skill that summarises a PDF",
    "create a skill for weekly reporting",
    "teach yourself a new skill for invoice triage",
    "make a skill that checks a contract for missing clauses",
    "save a new skill for drafting follow ups",
    "i want a skill that extracts action items from a meeting note",
    "build a reusable skill for expense review",
    "add a skill that turns a call transcript into a summary",
    "define a skill for triaging support tickets",
    "create a new skill and save it for later",
  ],
};

const slugs = Object.keys(UTTERANCES);
const rows: string[] = [];
let n = 0;

for (const [slug, utterances] of Object.entries(UTTERANCES)) {
  for (const text of utterances) {
    n += 1;
    const answers: Record<string, { type: "noul"; noul: number }> = {};
    const questions: Record<string, { type: "noul"; instructions: string }> = {};
    for (const other of slugs) {
      answers[other] = { type: "noul", noul: other === slug ? 0.99 : 0.01 };
      /*
       * The question text is carried, not just the answer: validation replays every row through the
       * engine, and the engine reads the question it is asked. Rows without it crash the pass.
       */
      questions[other] = {
        type: "noul",
        instructions: `Does this request need the "${other}" capability?`,
      };
    }
    rows.push(
      JSON.stringify({
        id: `rt-${slug}-${String(n).padStart(3, "0")}`,
        domain: "tools",
        state: { text },
        questions,
        answers,
      }),
    );
  }
}

const root = join(import.meta.dir, "..");
const out = join(root, "data", "tools", "runtime-skills.jsonl");
await mkdir(join(root, "data", "tools"), { recursive: true });
await writeFile(out, rows.join("\n") + "\n");
console.info(`Wrote ${rows.length} rows across ${slugs.length} skills to ${out}`);
