// Reproduces the measurements in 20260831T053634Z-pipeline-wall-time.md.
// Reads ~/.jarvis/telemetry.jsonl and a copy of ~/.jarvis/state/v2.sqlite (live DB is never opened).
// Wall = first run created_at -> last run end (finished_at, else the run's latest attempt completed_at),
// per workflow invocation. Agent = summed subprocess duration_ms over every telemetry row for the
// workflow's runs, quota-fallback retries included. Minutes throughout.
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT = "jarvis";
const TELEMETRY_START = Date.parse("2026-07-12T00:00:00Z");
const jarvisHome = join(process.env.HOME ?? "", ".jarvis");

type Run = {
  id: string;
  step_id: string | null;
  status: string;
  created_at: number;
  finished_at: number | null;
  wf: string | null;
};

function readTelemetry(): { durationByRun: Map<string, number>; rolesByRun: Map<string, Set<string>> } {
  const durationByRun = new Map<string, number>();
  const rolesByRun = new Map<string, Set<string>>();
  for (const line of readFileSync(join(jarvisHome, "telemetry.jsonl"), "utf8").split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line);
    if (row.record_kind !== "invocation_completed" || row.project !== PROJECT) continue;
    durationByRun.set(row.run_id, (durationByRun.get(row.run_id) ?? 0) + (row.duration_ms ?? 0));
    if (row.binding_index === 0) {
      const roles = rolesByRun.get(row.run_id) ?? new Set<string>();
      roles.add(row.role);
      rolesByRun.set(row.run_id, roles);
    }
  }
  return { durationByRun, rolesByRun };
}

function openStateDbCopy(): Database {
  const dir = mkdtempSync(join(tmpdir(), "wall-time-"));
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = join(jarvisHome, "state", `v2.sqlite${suffix}`);
    if (existsSync(source)) copyFileSync(source, join(dir, `v2.sqlite${suffix}`));
  }
  return new Database(join(dir, "v2.sqlite"), { readonly: true });
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
  const pick = (p: number): string => (sorted[Math.floor(n * p)] ?? 0).toFixed(1);
  return `n=${n} p10=${pick(0.1)} p50=${sorted[Math.floor(n / 2)]?.toFixed(1)} mean=${mean.toFixed(1)} p90=${pick(0.9)} max=${sorted[n - 1]?.toFixed(1)}`;
}

const { durationByRun, rolesByRun } = readTelemetry();
const db = openStateDbCopy();
const attemptEnd = new Map<string, number>(
  (
    db.query(`SELECT run_id, max(completed_at) latest FROM attempts GROUP BY run_id`).all() as {
      run_id: string;
      latest: number | null;
    }[]
  ).map((row) => [row.run_id, row.latest ?? 0]),
);
const runGroups = new Map<string, Run[]>();
for (const run of db
  .query(
    `SELECT id, step_id, status, created_at, finished_at, json_extract(workflow_snapshot,'$.invocationId') wf
     FROM runs WHERE project = ?`,
  )
  .all(PROJECT) as Run[]) {
  if (!run.wf) continue;
  const group = runGroups.get(run.wf) ?? [];
  group.push(run);
  runGroups.set(run.wf, group);
}

console.log("== Minutes per completed workflow, by stage cell (kind/review posture) ==");
const cells = new Map<string, { wall: number[]; agent: number[] }>();
for (const group of runGroups.values()) {
  if (Math.min(...group.map((r) => r.created_at)) < TELEMETRY_START) continue;
  if (!group.every((r) => r.status === "completed")) continue;
  if (!group.some((r) => durationByRun.has(r.id))) continue;
  const ends = group.map((r) => r.finished_at ?? attemptEnd.get(r.id) ?? 0);
  if (ends.some((end) => end === 0)) continue;
  const wall = (Math.max(...ends) - Math.min(...group.map((r) => r.created_at))) / 60000;
  const agent = group.reduce((sum, r) => sum + (durationByRun.get(r.id) ?? 0), 0) / 60000;
  const stepIds = group.map((r) => r.step_id ?? "");
  const roles = new Set(group.flatMap((r) => [...(rolesByRun.get(r.id) ?? [])]));
  const key = `${workflowKind(stepIds)}/${reviewPosture(stepIds, roles)}`;
  const cell = cells.get(key) ?? { wall: [], agent: [] };
  cell.wall.push(wall);
  cell.agent.push(agent);
  cells.set(key, cell);
}
for (const [key, cell] of [...cells.entries()].sort()) {
  console.log(`${key.padEnd(18)} wall  ${distribution(cell.wall)}`);
  console.log(`${"".padEnd(18)} agent ${distribution(cell.agent)}`);
}

console.log("\n== Active minutes per fully-succeeded pipeline (workflow stages; approval wait excluded) ==");
const pipelines = db
  .query(`SELECT id, name FROM pipelines WHERE json_extract(context,'$.cwd') LIKE '%/Work/' || ?`)
  .all(PROJECT) as { id: string; name: string }[];
for (const pipeline of pipelines) {
  const stages = db
    .query(
      `SELECT stage_id, status, started_at, ended_at, decided_at FROM pipeline_stages WHERE pipeline_id = ? ORDER BY position`,
    )
    .all(pipeline.id) as {
    stage_id: string;
    status: string;
    started_at: number | null;
    ended_at: number | null;
    decided_at: number | null;
  }[];
  if (!stages.every((s) => s.status === "succeeded" || s.status === "approved")) continue;
  let active = 0;
  const perStage = stages.map((stage) => {
    if (stage.status === "approved") return `${stage.stage_id}:approval`;
    const minutes = stage.started_at && stage.ended_at ? (stage.ended_at - stage.started_at) / 60000 : Number.NaN;
    active += minutes;
    return `${stage.stage_id}:${minutes.toFixed(1)}`;
  });
  const marks = stages.flatMap((s) => [s.started_at, s.ended_at, s.decided_at]).filter((t): t is number => t !== null);
  const span = (Math.max(...marks) - Math.min(...marks)) / 60000;
  console.log(`${pipeline.name}: active=${active.toFixed(1)} span=${span.toFixed(0)}  ${perStage.join("  ")}`);
}
