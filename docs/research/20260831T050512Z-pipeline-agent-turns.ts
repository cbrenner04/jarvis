// Reproduces the measurements in 20260831T050512Z-pipeline-agent-turns.md.
// Reads ~/.jarvis/telemetry.jsonl and a copy of ~/.jarvis/state/v2.sqlite (live DB is never opened).
// A turn = one `invocation_completed` row with binding_index 0; rows with binding_index > 0 are
// quota-fallback retries of the same logical call and count only toward the overhead stat.
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT = "jarvis";
const TELEMETRY_START = Date.parse("2026-07-12T00:00:00Z");
const jarvisHome = join(process.env.HOME ?? "", ".jarvis");

type TelemetryRow = { runId: string; role: string; bindingIndex: number };
type Run = { id: string; step_id: string | null; status: string; created_at: number; wf: string | null };

function readTelemetry(): { turns: TelemetryRow[]; rawRowsByRun: Map<string, number>; fallbackRows: number } {
  const turns: TelemetryRow[] = [];
  const rawRowsByRun = new Map<string, number>();
  let fallbackRows = 0;
  for (const line of readFileSync(join(jarvisHome, "telemetry.jsonl"), "utf8").split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line);
    if (row.record_kind !== "invocation_completed" || row.project !== PROJECT) continue;
    rawRowsByRun.set(row.run_id, (rawRowsByRun.get(row.run_id) ?? 0) + 1);
    if (row.binding_index > 0) fallbackRows += 1;
    else turns.push({ runId: row.run_id, role: row.role, bindingIndex: row.binding_index });
  }
  return { turns, rawRowsByRun, fallbackRows };
}

function openStateDbCopy(): Database {
  const dir = mkdtempSync(join(tmpdir(), "turn-stats-"));
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = join(jarvisHome, "state", `v2.sqlite${suffix}`);
    if (existsSync(source)) copyFileSync(source, join(dir, `v2.sqlite${suffix}`));
  }
  return new Database(join(dir, "v2.sqlite"), { readonly: true });
}

function groupRunsByWorkflow(db: Database): Map<string, Run[]> {
  const rows = db
    .query(
      `SELECT id, step_id, status, created_at, json_extract(workflow_snapshot,'$.invocationId') wf
       FROM runs WHERE project = ?`,
    )
    .all(PROJECT) as Run[];
  const groups = new Map<string, Run[]>();
  for (const run of rows) {
    if (!run.wf) continue;
    const group = groups.get(run.wf) ?? [];
    group.push(run);
    groups.set(run.wf, group);
  }
  return groups;
}

function workflowKind(stepIds: string[]): string {
  if (stepIds.some((s) => s.startsWith("implement"))) return "implement";
  if (stepIds.includes("plan")) return "plan";
  if (stepIds.includes("intent")) return "intent";
  return "other";
}

function reviewPosture(stepIds: string[], roles: Set<string>): string {
  if (stepIds.includes("review-debate") || stepIds.includes("implement-review")) {
    if (roles.has("adversary")) return "debate";
    return roles.has("critic") ? "light" : "review?";
  }
  return stepIds.includes("review") ? "light" : "none";
}

function distribution(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return `n=${n} min=${sorted[0]} p50=${sorted[Math.floor(n / 2)]} mean=${mean.toFixed(1)} p90=${sorted[Math.floor(n * 0.9)]} max=${sorted[n - 1]}`;
}

const { turns, rawRowsByRun, fallbackRows } = readTelemetry();
const turnsByRun = new Map<string, TelemetryRow[]>();
for (const turn of turns) {
  const group = turnsByRun.get(turn.runId) ?? [];
  group.push(turn);
  turnsByRun.set(turn.runId, group);
}

const db = openStateDbCopy();

console.log("== Turns per completed workflow, by stage cell (kind/review posture) ==");
const cells = new Map<string, { turnCounts: number[]; roleTotals: Map<string, number> }>();
for (const group of groupRunsByWorkflow(db).values()) {
  if (Math.min(...group.map((r) => r.created_at)) < TELEMETRY_START) continue;
  if (!group.every((r) => r.status === "completed")) continue;
  const groupTurns = group.flatMap((r) => turnsByRun.get(r.id) ?? []);
  if (groupTurns.length === 0) continue;
  const stepIds = group.map((r) => r.step_id ?? "");
  const roles = new Set(groupTurns.map((t) => t.role));
  const key = `${workflowKind(stepIds)}/${reviewPosture(stepIds, roles)}`;
  const cell = cells.get(key) ?? { turnCounts: [], roleTotals: new Map() };
  cell.turnCounts.push(groupTurns.length);
  for (const t of groupTurns) cell.roleTotals.set(t.role, (cell.roleTotals.get(t.role) ?? 0) + 1);
  cells.set(key, cell);
}
for (const [key, cell] of [...cells.entries()].sort()) {
  const roleMeans = [...cell.roleTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, total]) => `${role}=${(total / cell.turnCounts.length).toFixed(1)}`)
    .join(" ");
  console.log(`${key.padEnd(18)} ${distribution(cell.turnCounts)}`);
  console.log(`${"".padEnd(18)} role means/workflow: ${roleMeans}`);
}

console.log("\n== Raw subprocess rows per fully-succeeded pipeline (fallback retries included) ==");
const runsByWf = groupRunsByWorkflow(db);
const runWf = new Map<string, string>();
for (const [wf, group] of runsByWf) for (const run of group) runWf.set(run.id, wf);
const pipelines = db
  .query(`SELECT id, name FROM pipelines WHERE json_extract(context,'$.cwd') LIKE '%/Work/' || ?`)
  .all(PROJECT) as { id: string; name: string }[];
for (const pipeline of pipelines) {
  const stages = db
    .query(
      `SELECT stage_id, status, workflow_invocation_id FROM pipeline_stages WHERE pipeline_id = ? ORDER BY position`,
    )
    .all(pipeline.id) as { stage_id: string; status: string; workflow_invocation_id: string | null }[];
  if (!stages.every((s) => s.status === "succeeded" || s.status === "approved")) continue;
  const perStage = stages.map((stage) => {
    if (stage.status === "approved") return `${stage.stage_id}:approval`;
    const wf = stage.workflow_invocation_id ? runWf.get(stage.workflow_invocation_id) : undefined;
    const group = wf ? (runsByWf.get(wf) ?? []) : [];
    const rows = group.reduce((sum, run) => sum + (rawRowsByRun.get(run.id) ?? 0), 0);
    return `${stage.stage_id}:${rows}`;
  });
  console.log(`${pipeline.name}: ${perStage.join("  ")}`);
}

const logicalTurns = turns.length;
console.log(
  `\n== Quota-fallback overhead == ${fallbackRows} retry rows over ${logicalTurns} logical turns (+${((100 * fallbackRows) / logicalTurns).toFixed(0)}%)`,
);
