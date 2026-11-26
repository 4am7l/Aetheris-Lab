import type { D1Database } from "@cloudflare/workers-types";
import { publicInputSchema } from "../src/domain";
import type { AgentStatus, Evidence, PreliminaryReport } from "../src/review";
import { providerFor, type AIConfig } from "./ai";
import { calculate } from "./chemistry";
import { GeminiFailure, geminiTimeoutMs } from "./gemini";
import { assembleScientificReport, scientificContext } from "./scientificReport";
import { scientificSources } from "./sources";

type AgentEnv = AIConfig & { DB: D1Database; AGENT_ENABLED?: string };
type End = Exclude<AgentStatus, "running">;
// The lease covers bounded source requests, the provider deadline and D1 writes.
const leaseMs = 4 * 60_000;
const finalWriteMarginMs = 15_000;
const activeRun = "WHERE id = ? AND status = 'running' AND lease_until > ?";

async function saveEvidence(db: D1Database, runId: string, evidence: Evidence[], report: PreliminaryReport) {
  const timestamp = new Date().toISOString();
  const batch = evidence.map(({ id, source, kind, solution, title, url, excerpt, retrievedAt }) =>
    db.prepare(
      `INSERT INTO public_assessment_evidence (id, run_id, source, kind, solution, title, url, excerpt, retrieved_at)
       SELECT ?, id, ?, ?, ?, ?, ?, ?, ? FROM public_agent_runs ${activeRun}`,
    ).bind(id, source, kind, solution, title, url, excerpt, retrievedAt, runId, timestamp),
  );
  batch.push(db.prepare(
    `INSERT INTO public_assessment_drafts (run_id, report_json, created_at)
     SELECT id, ?, ? FROM public_agent_runs ${activeRun} RETURNING run_id`,
  ).bind(JSON.stringify(report), timestamp, runId, timestamp));
  const writes = await db.batch(batch);
  return Boolean(writes.at(-1)?.results.length);
}

async function finish(db: D1Database, runId: string, status: End, failure: string | null, report: PreliminaryReport | null) {
  const timestamp = new Date().toISOString();
  const transition = db.prepare(
    `UPDATE public_agent_runs SET status = ?, finished_at = ?, failure_code = ? ${activeRun}`,
  ).bind(status, timestamp, failure, runId, timestamp);
  if (!report) {
    await transition.run();
    return;
  }
  await db.batch([
    db.prepare(
      `UPDATE public_assessment_drafts SET report_json = ?
       WHERE run_id IN (SELECT id FROM public_agent_runs ${activeRun})`,
    ).bind(JSON.stringify(report), runId, timestamp),
    transition,
  ]);
}

export async function processNextRequest(env: AgentEnv) {
  if (!env.DB || env.AGENT_ENABLED !== "true") return;
  const db = env.DB;
  const provider = providerFor(env);
  const reclaimAt = new Date().toISOString();
  // Reclaim abandoned runs as failures. All stale writes are fenced by run ID and lease.
  await db.prepare(
    `UPDATE public_agent_runs SET status = 'failed', finished_at = ?, failure_code = 'LEASE_EXPIRED'
     WHERE status = 'running' AND lease_until <= ?`,
  ).bind(reclaimAt, reclaimAt).run();

  const startedAt = new Date();
  const leaseUntil = startedAt.getTime() + leaseMs;
  const runId = crypto.randomUUID();
  const run = await db.prepare(
    `INSERT INTO public_agent_runs (id, request_id, status, started_at, lease_until, provider, model)
     SELECT ?, request_id, 'running', ?, ?, ?, ? FROM public_request_workflow
     WHERE status = 'Submitted' AND archived_at IS NULL
     ORDER BY updated_at, request_id LIMIT 1
     RETURNING request_id AS requestId`,
  ).bind(runId, startedAt.toISOString(), new Date(leaseUntil).toISOString(),
    provider?.name ?? null, provider?.model ?? null).first<{ requestId: string }>();
  if (!run) return;

  let status: End = provider ? "completed" : "unconfigured";
  let failure: string | null = null;
  let assessedReport: PreliminaryReport | null = null;
  try {
    const request = await db.prepare("SELECT input_json FROM public_requests WHERE id = ?")
      .bind(run.requestId).first<{ input_json: string }>();
    const input = publicInputSchema.parse(JSON.parse(request?.input_json ?? "null"));
    const calculation = calculate(input);
    const collect = scientificSources(runId);
    const results = await Promise.all([collect(input.a, "A"), collect(input.b, "B")]);
    const evidence = results.flatMap((result) => result.evidence);
    const report: PreliminaryReport = {
      identities: results.map((result) => result.identity),
      gaps: results.flatMap((result) => result.gaps),
      assessment: null,
      calculation,
    };
    if (!input.conditions.trim() && !input.calculation) report.gaps.push({ code: "conditions" });
    const context = provider?.name === "openai" ? null : scientificContext(input, report, evidence);
    if (context) {
      report.scientificReport = assembleScientificReport(
        context, context.candidates.map(({ code }) => code), "evidence-review",
      );
    }
    // Save the evidence-only draft before dispatch so it survives a canceled invocation.
    if (!await saveEvidence(db, runId, evidence, report)) return;

    if (provider?.name === "gemini" && context && (context.data.evidence.length || calculation.status === "calculated")) {
      if (leaseUntil - Date.now() < geminiTimeoutMs + finalWriteMarginMs) {
        status = "failed";
        failure = "LEASE_INSUFFICIENT";
        console.warn({ event: "assessment_lease_insufficient", runId });
      } else {
        try {
          const scientificReport = await provider.assess(context, runId);
          assessedReport = { ...report, scientificReport };
        } catch (cause) {
          status = "failed";
          failure = cause instanceof GeminiFailure ? cause.code : "AI_UNAVAILABLE";
        }
      }
    } else if (provider?.name === "openai") {
      if (!evidence.length && report.gaps.some(({ code }) =>
        code === "pubchemUnavailable" || code === "nioshUnavailable")) {
        status = "failed";
        failure = "EVIDENCE_UNAVAILABLE";
      } else {
        try {
          const assessment = await provider.assess(report, evidence);
          assessedReport = { ...report, assessment };
        } catch {
          status = "failed";
          failure = "AI_UNAVAILABLE_OR_INVALID";
        }
      }
    }
  } catch {
    status = "failed";
    failure = "REQUEST_UNAVAILABLE";
  }
  await finish(db, runId, status, failure, assessedReport);
}
