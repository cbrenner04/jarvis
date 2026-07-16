import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { consumePublicationInputs } from "../../../shared/publication-input-consumption.ts";
import { type IntentOutputConfig, landIntentWorkflowOutput } from "./intent-output.ts";

type PublicationInputs = { sourceRoot: string; paths: string[]; consumeFrom: "worktree" | "source" };

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

export type PublicationLandingResult = { specPath: string; files: string[] };

function fail(message: string): never {
  throw new Error(`${message}; rerun to retry pre-publication`);
}

function planFiles(stage: string): string[] {
  if (!existsSync(stage) || !statSync(stage).isDirectory()) fail("plan: .jarvis-plan-stage is missing");
  const files = readdirSync(stage, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name === "index.md" || entry.name === "intent.md" || /^\d{2}-.*\.md$/u.test(entry.name)),
    )
    .map((entry) => entry.name)
    .sort();
  if (
    !files.includes("index.md") ||
    !files.includes("intent.md") ||
    !files.some((file) => /^\d{2}-.*\.md$/u.test(file))
  )
    fail("plan: staged spec tree has invalid shape");
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
    const files = planFiles(durablePath);
    if (landing.inputs !== undefined) consumeInputs(landing.inputs, worktreePath);
    return { specPath: relativePath(root, durablePath), files };
  }
  const files = planFiles(landing.stagingDir);
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
          fail(`plan: ${file} already exists with different contents`);
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
