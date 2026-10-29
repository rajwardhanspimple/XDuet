import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { DecisionAnswers, DecisionQuestion } from "./types";

export type SupervisionStatus = "pending" | "approved" | "corrected";

export type DecisionAuditEntry = {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  domain: string;
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  answers: DecisionAnswers;
  latencyMs: number;
  supervision: {
    status: SupervisionStatus;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
    notes?: string | null;
    correctedAnswers?: DecisionAnswers | null;
  };
};

const DEFAULT_AUDIT_LOG_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "data",
  "decisions",
  "decision-audit.jsonl",
);

function resolveLogPath(customPath?: string): string {
  if (!customPath) return DEFAULT_AUDIT_LOG_PATH;
  if (customPath.startsWith("data/") || customPath.startsWith("data\\")) {
    return join(import.meta.dir, "..", "..", "..", customPath);
  }
  return resolve(process.cwd(), customPath);
}

/**
 * Determine the domain from questions and state.
 */
export function detectDecisionDomain(
  questions: Record<string, DecisionQuestion>,
  state: unknown,
): string {
  const qKeys = Object.keys(questions);
  if (qKeys.includes("needs_you")) return "triage";
  if (
    qKeys.includes("verdict") ||
    qKeys.includes("pre_approved") ||
    qKeys.includes("beyond_request")
  )
    return "safety";
  if (qKeys.includes("coworker")) return "routing";
  const toolSkills = [
    "weather",
    "calendar",
    "email",
    "github",
    "shell",
    "computer",
    "database",
    "memory",
  ];
  if (qKeys.some((k) => toolSkills.includes(k.replace(/^skill:/, ""))))
    return "tool_selection";
  return "other";
}

/**
 * Record a live decision to the audit log file.
 * Non-blocking, never throws.
 */
export async function recordDecisionAudit(
  entry: Omit<
    DecisionAuditEntry,
    "id" | "timestamp" | "supervision" | "domain"
  > & {
    id?: string;
    timestamp?: string;
    domain?: string;
    supervision?: Partial<DecisionAuditEntry["supervision"]>;
  },
  customPath?: string,
): Promise<DecisionAuditEntry> {
  const filePath = resolveLogPath(customPath);
  const auditEntry: DecisionAuditEntry = {
    id:
      entry.id || `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    provider: entry.provider,
    model: entry.model,
    domain: entry.domain || detectDecisionDomain(entry.questions, entry.state),
    state: entry.state,
    questions: entry.questions,
    answers: entry.answers,
    latencyMs: Number(entry.latencyMs.toFixed(3)),
    supervision: {
      status: (entry.supervision?.status as SupervisionStatus) || "pending",
      reviewedAt: entry.supervision?.reviewedAt || null,
      reviewedBy: entry.supervision?.reviewedBy || null,
      notes: entry.supervision?.notes || null,
      correctedAnswers: entry.supervision?.correctedAnswers || null,
    },
  };

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(auditEntry) + "\n", "utf8");
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "decision_audit_log_error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  return auditEntry;
}

/**
 * Read all decision audit entries.
 */
export async function readDecisionAuditEntries(
  customPath?: string,
): Promise<DecisionAuditEntry[]> {
  const filePath = resolveLogPath(customPath);
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          const entry = JSON.parse(line);
          if (!entry || typeof entry !== "object") return null;
          if (!entry.supervision) {
            entry.supervision = {
              status: "pending",
              reviewedAt: null,
              reviewedBy: null,
              notes: null,
              correctedAnswers: null,
            };
          }
          if (!entry.domain && entry.questions) {
            entry.domain = detectDecisionDomain(entry.questions, entry.state);
          }
          if (!entry.id) {
            entry.id = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          }
          return entry as DecisionAuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is DecisionAuditEntry => e !== null);
  } catch {
    return [];
  }
}

/**
 * Update supervision status of an existing decision audit entry.
 */
export async function updateDecisionSupervision(
  id: string,
  update: {
    status: SupervisionStatus;
    correctedAnswers?: DecisionAnswers | null;
    notes?: string | null;
    reviewedBy?: string | null;
  },
  customPath?: string,
): Promise<DecisionAuditEntry | null> {
  const filePath = resolveLogPath(customPath);
  const entries = await readDecisionAuditEntries(filePath);
  const target = entries.find((e) => e.id === id);
  if (!target) return null;

  target.supervision.status = update.status;
  target.supervision.reviewedAt = new Date().toISOString();
  if (update.reviewedBy !== undefined)
    target.supervision.reviewedBy = update.reviewedBy;
  if (update.notes !== undefined) target.supervision.notes = update.notes;
  if (update.correctedAnswers !== undefined)
    target.supervision.correctedAnswers = update.correctedAnswers;

  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(filePath, content, "utf8");
  return target;
}

/**
 * Compute supervision statistics.
 */
export async function getDecisionAuditStats(customPath?: string) {
  const entries = await readDecisionAuditEntries(customPath);
  const stats = {
    total: entries.length,
    byStatus: { pending: 0, approved: 0, corrected: 0 } as Record<
      string,
      number
    >,
    byDomain: {} as Record<string, number>,
    byModel: {} as Record<string, number>,
    avgLatencyMs: 0,
  };

  let totalLatency = 0;
  for (const e of entries) {
    const status = e.supervision?.status || "pending";
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
    const domain = e.domain || "other";
    stats.byDomain[domain] = (stats.byDomain[domain] || 0) + 1;
    const model = e.model || "unknown";
    stats.byModel[model] = (stats.byModel[model] || 0) + 1;
    totalLatency += e.latencyMs || 0;
  }

  stats.avgLatencyMs =
    entries.length > 0 ? Number((totalLatency / entries.length).toFixed(3)) : 0;
  return stats;
}
