import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { openStateStore, type Pipeline, type Run, type StateStore } from "./state-store.ts";
import { removeOrchestrationStore } from "./state-store-on-disk.ts";

const PRE_SQUASH_MIGRATION_IDS = [
  "004-invocation-failure-detail",
  "005-run-step-id",
  "006-run-workflow-snapshot",
  "007-run-queued-input",
  "008-attempt-completion-agent",
  "009-run-creation-title",
  "010-run-reconciliation-pending",
  "011-run-owner-identity",
  "012-run-pr-evidence",
  "013-pipelines-and-stages",
  "014-pipeline-owner-identity-and-status",
  "015-pipeline-context",
  "016-run-reconciled-at",
  "017-run-ready-gate-repair-fence",
  "018-pipeline-terminal-publication",
  "019-run-retained-finalization-checkpoint",
  "020-pipeline-stage-branch-key",
  "021-run-downstream-inputs",
  "022-pipeline-stage-admission",
  "023-run-finished-at",
  "024-pipeline-stage-decided-at",
  "025-run-ready-gate-pgid",
  "026-attempts-completion-review-pass",
  "027-pipeline-dismissed-at",
  "028-run-dismissed-at",
  "029-run-terminal-settlement-columns",
  "030-operator-notification-delivery",
] as const;

const SAMPLE_PIPELINE_DEFINITION: PipelineDefinition = {
  name: "baseline-fixture-pipeline",
  stages: [
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "gate", kind: "approval" },
  ],
};

const FIXTURE_RUN_ID = "baseline-fixture-run";
const FIXTURE_ATTEMPT_ID = "baseline-fixture-attempt";
const FIXTURE_PIPELINE_ID = "baseline-fixture-pipeline";
const FIXTURE_STAGE_ID = "baseline-fixture-stage";
const FIXTURE_CREATED_AT = 1_700_000_000_000;

const FIXTURE_WORKFLOW_SNAPSHOT = {
  invocationId: "baseline-invocation",
  steps: [{ stepId: "implement", role: "implement" }],
};

const FIXTURE_PIPELINE_CONTEXT = {
  cwd: "/repo",
  configPath: "/repo/.jarvis/config.json",
  targetDir: "v2/spec",
};

type FixtureSeed = {
  runId: string;
  attemptId: string;
  pipelineId: string;
  stageId: string;
};

function stampPreSquashMigrations(raw: Database): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  for (const id of PRE_SQUASH_MIGRATION_IDS) {
    raw.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
  }
}

function createPreSquashFixtureDb(dbPath: string): FixtureSeed {
  removeOrchestrationStore(dbPath);
  const raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      spec_ref TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      worktree_path TEXT NOT NULL,
      branch TEXT NOT NULL,
      spec_path TEXT NOT NULL,
      step_id TEXT,
      workflow_snapshot TEXT,
      queued_input TEXT,
      creation_title TEXT,
      reconciliation_pending INTEGER NOT NULL DEFAULT 0,
      owner_identity TEXT,
      pr_number INTEGER,
      pr_url TEXT,
      reconciled_at INTEGER,
      ready_gate_repair_fence TEXT,
      retained_finalization_checkpoint TEXT,
      downstream_inputs TEXT,
      finished_at INTEGER,
      ready_gate_pgid INTEGER,
      dismissed_at INTEGER,
      terminal_cause TEXT,
      terminal_failure_detail TEXT
    );
    CREATE TABLE attempts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      outcome_kind TEXT,
      completed_at INTEGER,
      invocation_failure_detail TEXT,
      completion_agent TEXT,
      completion_review_pass INTEGER,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
    CREATE TABLE pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      definition TEXT NOT NULL,
      owner_identity TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      context TEXT,
      terminal_publication_failure TEXT,
      terminal_publication_succeeded_at INTEGER,
      dismissed_at INTEGER
    );
    CREATE TABLE pipeline_stages (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
      stage_id TEXT NOT NULL,
      branch_key TEXT NOT NULL DEFAULT 'default',
      position INTEGER NOT NULL,
      status TEXT NOT NULL,
      workflow_invocation_id TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      artifact TEXT,
      failure_detail TEXT,
      decided_at INTEGER,
      UNIQUE (pipeline_id, stage_id, branch_key)
    );
    CREATE TABLE pipeline_stage_admission (
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
      stage_id TEXT NOT NULL,
      branch_key TEXT NOT NULL,
      holder_identity TEXT NOT NULL,
      PRIMARY KEY (pipeline_id, stage_id, branch_key)
    );
    CREATE TABLE operator_notification_deliveries (
      incident_id TEXT NOT NULL,
      transition TEXT NOT NULL,
      delivered_at INTEGER NOT NULL,
      PRIMARY KEY (incident_id, transition)
    );
  `);
  stampPreSquashMigrations(raw);
  raw
    .prepare(
      `INSERT INTO runs (
        id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path,
        step_id, workflow_snapshot, creation_title, owner_identity, pr_number, pr_url, finished_at,
        terminal_cause, terminal_failure_detail
      ) VALUES (?, 'fixture-project', 'main', ?, 'completed', 1, '/tmp/fixture', 'fixture-branch', 'spec.md',
        ?, ?, 'fixture title', 'fixture-owner:1', 42, 'https://example.com/pr/42', ?, 'done', NULL)`,
    )
    .run(
      FIXTURE_RUN_ID,
      FIXTURE_CREATED_AT,
      "implement",
      JSON.stringify(FIXTURE_WORKFLOW_SNAPSHOT),
      FIXTURE_CREATED_AT + 1000,
    );
  raw
    .prepare(
      `INSERT INTO attempts (
        id, run_id, attempt_number, started_at, status, outcome_kind, completed_at, completion_agent, completion_review_pass
      ) VALUES (?, ?, 1, ?, 'completed', 'done', ?, 'cursor', 0)`,
    )
    .run(FIXTURE_ATTEMPT_ID, FIXTURE_RUN_ID, FIXTURE_CREATED_AT + 100, FIXTURE_CREATED_AT + 900);
  raw
    .prepare(
      `INSERT INTO pipelines (
        id, name, created_at, owner_identity, status, definition, context, dismissed_at
      ) VALUES (?, ?, ?, 'fixture-owner:1', 'active', ?, ?, NULL)`,
    )
    .run(
      FIXTURE_PIPELINE_ID,
      SAMPLE_PIPELINE_DEFINITION.name,
      FIXTURE_CREATED_AT,
      JSON.stringify(SAMPLE_PIPELINE_DEFINITION),
      JSON.stringify(FIXTURE_PIPELINE_CONTEXT),
    );
  raw
    .prepare(
      `INSERT INTO pipeline_stages (
        id, pipeline_id, stage_id, branch_key, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail, decided_at
      ) VALUES (?, ?, 'plan', 'default', 0, 'succeeded', 'workflow-plan', ?, ?, ?, NULL, NULL)`,
    )
    .run(
      FIXTURE_STAGE_ID,
      FIXTURE_PIPELINE_ID,
      FIXTURE_CREATED_AT + 200,
      FIXTURE_CREATED_AT + 800,
      JSON.stringify({ specPath: "spec/plan.md" }),
    );
  raw.close();
  return {
    runId: FIXTURE_RUN_ID,
    attemptId: FIXTURE_ATTEMPT_ID,
    pipelineId: FIXTURE_PIPELINE_ID,
    stageId: FIXTURE_STAGE_ID,
  };
}

function seedEquivalentBaselineDb(dbPath: string, ids: FixtureSeed): void {
  const store = openStateStore(dbPath);
  const raw = new Database(dbPath);
  raw
    .prepare(
      `INSERT INTO runs (
        id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path,
        step_id, workflow_snapshot, creation_title, owner_identity, pr_number, pr_url, finished_at,
        terminal_cause, terminal_failure_detail
      ) VALUES (?, 'fixture-project', 'main', ?, 'completed', 1, '/tmp/fixture', 'fixture-branch', 'spec.md',
        ?, ?, 'fixture title', 'fixture-owner:1', 42, 'https://example.com/pr/42', ?, 'done', NULL)`,
    )
    .run(
      ids.runId,
      FIXTURE_CREATED_AT,
      "implement",
      JSON.stringify(FIXTURE_WORKFLOW_SNAPSHOT),
      FIXTURE_CREATED_AT + 1000,
    );
  raw
    .prepare(
      `INSERT INTO attempts (
        id, run_id, attempt_number, started_at, status, outcome_kind, completed_at, completion_agent, completion_review_pass
      ) VALUES (?, ?, 1, ?, 'completed', 'done', ?, 'cursor', 0)`,
    )
    .run(ids.attemptId, ids.runId, FIXTURE_CREATED_AT + 100, FIXTURE_CREATED_AT + 900);
  raw
    .prepare(
      `INSERT INTO pipelines (
        id, name, created_at, owner_identity, status, definition, context, dismissed_at
      ) VALUES (?, ?, ?, 'fixture-owner:1', 'active', ?, ?, NULL)`,
    )
    .run(
      ids.pipelineId,
      SAMPLE_PIPELINE_DEFINITION.name,
      FIXTURE_CREATED_AT,
      JSON.stringify(SAMPLE_PIPELINE_DEFINITION),
      JSON.stringify(FIXTURE_PIPELINE_CONTEXT),
    );
  raw
    .prepare(
      `INSERT INTO pipeline_stages (
        id, pipeline_id, stage_id, branch_key, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail, decided_at
      ) VALUES (?, ?, 'plan', 'default', 0, 'succeeded', 'workflow-plan', ?, ?, ?, NULL, NULL)`,
    )
    .run(
      ids.stageId,
      ids.pipelineId,
      FIXTURE_CREATED_AT + 200,
      FIXTURE_CREATED_AT + 800,
      JSON.stringify({ specPath: "spec/plan.md" }),
    );
  raw.close();
  store.close();
}

function visibleRunShape(run: Run & { attempts: NonNullable<ReturnType<StateStore["loadRun"]>>["attempts"] }) {
  const { attempts, ...rest } = run;
  return {
    ...rest,
    attempts: attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      outcomeKind: attempt.outcomeKind,
      completionAgent: attempt.completionAgent,
      completionReviewPass: attempt.completionReviewPass,
    })),
  };
}

function visiblePipelineShape(
  pipeline: Pipeline & { stages: NonNullable<ReturnType<StateStore["loadPipeline"]>>["stages"] },
) {
  return {
    name: pipeline.name,
    ownerIdentity: pipeline.ownerIdentity,
    status: pipeline.status,
    definition: pipeline.definition,
    context: pipeline.context,
    dismissedAt: pipeline.dismissedAt,
    stages: pipeline.stages.map((stage) => ({
      stageId: stage.stageId,
      branchKey: stage.branchKey,
      position: stage.position,
      status: stage.status,
      workflowInvocationId: stage.workflowInvocationId,
      startedAt: stage.startedAt,
      endedAt: stage.endedAt,
      artifact: stage.artifact,
      failureDetail: stage.failureDetail,
      decidedAt: stage.decidedAt,
    })),
  };
}

describe("state store baseline migration", () => {
  const legacyDbPath = join(tmpdir(), "jarvis-test-state-baseline-legacy.sqlite");
  const freshDbPath = join(tmpdir(), "jarvis-test-state-baseline-fresh.sqlite");

  afterEach(() => {
    removeOrchestrationStore(legacyDbPath);
    removeOrchestrationStore(freshDbPath);
  });

  test("pre-squash fixture at migration 030 and fresh baseline expose equivalent row visibility", () => {
    const ids = createPreSquashFixtureDb(legacyDbPath);
    seedEquivalentBaselineDb(freshDbPath, ids);

    const legacyStore = openStateStore(legacyDbPath);
    const freshStore = openStateStore(freshDbPath);
    try {
      const legacyRun = legacyStore.loadRun(ids.runId);
      const freshRun = freshStore.loadRun(ids.runId);
      if (!legacyRun || !freshRun) throw new Error("fixture run should load");
      expect(visibleRunShape(legacyRun)).toEqual(visibleRunShape(freshRun));

      const legacyPipeline = legacyStore.loadPipeline(ids.pipelineId);
      const freshPipeline = freshStore.loadPipeline(ids.pipelineId);
      if (!legacyPipeline || !freshPipeline) throw new Error("fixture pipeline should load");
      expect(visiblePipelineShape(legacyPipeline)).toEqual(visiblePipelineShape(freshPipeline));

      const verify = new Database(legacyDbPath);
      const squashApplied = verify
        .prepare("SELECT 1 AS ok FROM _migrations WHERE id = '031-baseline-squash'")
        .get() as { ok: number } | null;
      expect(squashApplied?.ok).toBe(1);
      verify.close();
    } finally {
      legacyStore.close();
      freshStore.close();
    }
  });
});
