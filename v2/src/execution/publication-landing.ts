import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { errorMessage } from "../../../shared/error-message.ts";
import type { OperatorFailurePathOrigin, OperatorFailureRecord } from "../../../shared/operator-failure-record.ts";
import { consumePublicationInputs } from "../../../shared/publication-input-consumption.ts";
import { type IntentOutputConfig, landIntentWorkflowOutput } from "./intent-output.ts";

/** Seed files a landing consumes after publishing; persisted on the workflow snapshot so resume consumes the same set. */
export type PublicationInputs = { sourceRoot: string; paths: string[]; consumeFrom: "worktree" | "source" };

export type PublicationLanding =
  | {
      kind: "intent-stage";
      output: IntentOutputConfig;
      stagingDir: string;
      invocationId: string;
      baseRef: string;
      inputs?: PublicationInputs;
    }
  | {
      kind: "plan-tree";
      stagingDir: string;
      durablePath: string;
      inputs?: PublicationInputs;
    }
  | { kind: "none" };

type PublicationLandingResult = { specPath: string; files: string[] };

/**
 * Pure (no filesystem writes) check that `stage` satisfies the plan-tree landing contract —
 * reused by plan-stage recovery to revalidate staged bytes immediately before landing, in
 * addition to the same check `landPlanTree` runs at actual landing time.
 */
export function checkPlanTreeLanding(stage: string): { ok: true } | { ok: false; reason: string } {
  try {
    planFiles(stage, "harness-internal");
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

export class PlanTreeLandingError extends Error {
  readonly operatorFailureRecord: OperatorFailureRecord;

  constructor(message: string, operatorFailureRecord: OperatorFailureRecord) {
    super(`${message}; rerun to retry pre-publication`);
    this.name = "PlanTreeLandingError";
    this.operatorFailureRecord = operatorFailureRecord;
  }
}

function failPlanTree(message: string, operatorFailureRecord: OperatorFailureRecord): never {
  throw new PlanTreeLandingError(message, operatorFailureRecord);
}

const NUMBERED_SUBSPEC_PATTERN = /^\d{2}-.*\.md$/u;
const INDEX_LINK_PATTERN = /^\s*-\s\[[ xX]\]\s+\[[^\]]+\]\((?:\.\/)?([^)]+)\)/u;

/**
 * Durable plan content is exactly `index.md`, `intent.md`, and numbered subspec Markdown linked
 * from the index — a numbered file present on disk but not linked from `index.md` is rejected
 * rather than silently copied. Applies identically to ordinary and recovered landing, since both
 * flow through {@link planFiles}.
 */
function assertLinkedNumberedSubspecs(
  stage: string,
  files: readonly string[],
  origin: OperatorFailurePathOrigin,
): void {
  const numbered = files.filter((file) => NUMBERED_SUBSPEC_PATTERN.test(file));
  if (numbered.length === 0) return;
  const indexBody = readFileSync(join(stage, "index.md"), "utf8").replace(/\r\n/g, "\n");
  const linked = new Set<string>();
  for (const line of indexBody.split("\n")) {
    const match = line.match(INDEX_LINK_PATTERN);
    if (match?.[1] !== undefined) linked.add(match[1]);
  }
  for (const file of numbered) {
    if (linked.has(file)) continue;
    const candidateLine = indexBody.split("\n").find((line) => line.includes(file));
    const messageObservation =
      candidateLine !== undefined
        ? "index.md mentions the file but has no parseable checkbox link to it"
        : "no index.md line links this file";
    failPlanTree(`plan: unlinked_numbered_subspec: ${file}: ${messageObservation}`, {
      expectation: `index.md contains a parseable checkbox link to ${file}`,
      observation:
        candidateLine !== undefined
          ? `index.md mentions ${file}, but the candidate line is not a parseable checkbox link`
          : `index.md contains no candidate line mentioning ${file}`,
      ...(candidateLine !== undefined ? { nearMiss: candidateLine } : {}),
      retryable: false,
      referencedPaths: [{ path: stage, origin }],
    });
  }
}

function planFiles(stage: string, origin: OperatorFailurePathOrigin): string[] {
  if (!existsSync(stage) || !statSync(stage).isDirectory()) {
    failPlanTree("plan: .jarvis-plan-stage is missing", {
      expectation: "plan landing source is an existing directory",
      observation: "plan landing source is missing or is not a directory",
      retryable: false,
      referencedPaths: [{ path: stage, origin }],
    });
  }
  const files = readdirSync(stage, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name === "index.md" || entry.name === "intent.md" || NUMBERED_SUBSPEC_PATTERN.test(entry.name)),
    )
    .map((entry) => entry.name)
    .sort();
  if (
    !files.includes("index.md") ||
    !files.includes("intent.md") ||
    !files.some((file) => NUMBERED_SUBSPEC_PATTERN.test(file))
  )
    failPlanTree("plan: staged spec tree has invalid shape", {
      expectation: "plan tree contains index.md, intent.md, and at least one numbered subspec",
      observation: `plan tree files are ${files.length === 0 ? "(none)" : files.join(", ")}`,
      retryable: false,
      referencedPaths: [{ path: stage, origin }],
    });
  assertLinkedNumberedSubspecs(stage, files, origin);
  return files;
}

function relativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}

function consumeInputs(inputs: PublicationInputs, worktreePath: string): void {
  consumePublicationInputs({
    sourceRoot: inputs.sourceRoot,
    publicationRoot: inputs.consumeFrom === "source" ? inputs.sourceRoot : worktreePath,
    inputPaths: inputs.paths,
  });
}

function landPlanTree(
  landing: Extract<PublicationLanding, { kind: "plan-tree" }>,
  worktreePath: string,
): PublicationLandingResult {
  const durablePath = resolve(landing.durablePath);
  const root = resolve(landing.stagingDir, "..");
  if (!existsSync(landing.stagingDir) && existsSync(durablePath)) {
    const files = planFiles(durablePath, "operator-repository");
    if (landing.inputs !== undefined) consumeInputs(landing.inputs, worktreePath);
    return { specPath: relativePath(root, durablePath), files };
  }
  const files = planFiles(landing.stagingDir, "harness-internal");
  const backup = join(root, `.jarvis-plan-backup-${crypto.randomUUID()}`);
  const created: string[] = [];
  const backups: Array<[string, string]> = [];
  try {
    mkdirSync(durablePath, { recursive: true });
    for (const file of files) {
      const source = join(landing.stagingDir, file);
      const destination = join(durablePath, file);
      if (existsSync(destination)) {
        if (readFileSync(source).compare(readFileSync(destination)) !== 0)
          failPlanTree(`plan: ${file} already exists with different contents`, {
            expectation: `${file} is absent from the durable plan tree or byte-identical to the staged file`,
            observation: `${file} exists in the durable plan tree with different contents`,
            retryable: false,
            referencedPaths: [
              { path: source, origin: "harness-internal" },
              { path: destination, origin: "operator-repository" },
            ],
          });
      } else {
        created.push(destination);
      }
    }
    mkdirSync(backup, { recursive: true });
    for (const destination of created) {
      const file = basename(destination);
      copyFileSync(join(landing.stagingDir, file), destination);
      backups.push([destination, join(backup, file)]);
    }
    rmSync(landing.stagingDir, { recursive: true, force: true });
    rmSync(backup, { recursive: true, force: true });
    if (landing.inputs !== undefined) consumeInputs(landing.inputs, worktreePath);
    return { specPath: relativePath(root, durablePath), files };
  } catch (error) {
    for (const destination of created) rmSync(destination, { force: true });
    for (const [destination, backupPath] of backups) {
      if (existsSync(backupPath)) copyFileSync(backupPath, destination);
    }
    rmSync(backup, { recursive: true, force: true });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function landPublication(
  landing: PublicationLanding,
  worktreePath: string,
): Promise<PublicationLandingResult> {
  if (landing.kind === "none") return { specPath: "", files: [] };
  if (landing.kind === "intent-stage") {
    const result = await landIntentWorkflowOutput({
      worktreePath,
      baseRef: landing.baseRef,
      output: landing.output,
      invocationId: landing.invocationId,
    });
    if (landing.inputs !== undefined) consumeInputs(landing.inputs, worktreePath);
    return result;
  }
  return landPlanTree(
    {
      ...landing,
      stagingDir: resolve(worktreePath, landing.stagingDir),
      durablePath: resolve(worktreePath, landing.durablePath),
    },
    worktreePath,
  );
}
