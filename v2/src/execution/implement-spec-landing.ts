import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { errorMessage } from "../../../shared/error-message.ts";
import { listMarkdownFilesRecursive } from "./fs-walk.ts";

type LandImplementSpecTreeInput = {
  worktreePath: string;
  specReadRoot: string;
  specPath: string;
};

type LandImplementSpecTreeResult = { ok: true; specPath: string } | { ok: false; error: string };

function worktreeRelativeSpecPath(worktreePath: string, specPath: string): string {
  const absolute = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
  return relative(worktreePath, absolute).replace(/\\/g, "/");
}

/** Copy the routed spec tree from `specReadRoot` into the implement worktree for publication commits. */
export function landImplementSpecTreeFromReadRoot(input: LandImplementSpecTreeInput): LandImplementSpecTreeResult {
  let worktreeCanonical: string;
  let readRootCanonical: string;
  try {
    worktreeCanonical = realpathSync(input.worktreePath);
    readRootCanonical = realpathSync(input.specReadRoot);
  } catch (error) {
    const message = errorMessage(error);
    return { ok: false, error: `implement.spec_landing_unreadable: ${message}` };
  }

  if (worktreeCanonical === readRootCanonical) {
    return { ok: true, specPath: worktreeRelativeSpecPath(input.worktreePath, input.specPath) };
  }

  const { worktreePath, specReadRoot } = input;
  const absoluteSpecPath = isAbsolute(input.specPath) ? input.specPath : join(specReadRoot, input.specPath);
  const specDir = dirname(absoluteSpecPath);
  if (!existsSync(specDir)) {
    return { ok: false, error: `implement.spec_landing_missing: spec tree absent at ${specDir}` };
  }

  const relSpecPath = relative(specReadRoot, absoluteSpecPath).replace(/\\/g, "/");
  if (relSpecPath.startsWith("..")) {
    return { ok: false, error: `implement.spec_landing_out_of_tree: ${absoluteSpecPath}` };
  }

  for (const src of listMarkdownFilesRecursive(specDir)) {
    const relFromReadRoot = relative(specReadRoot, src);
    if (relFromReadRoot.startsWith("..")) {
      return { ok: false, error: `implement.spec_landing_out_of_tree: ${src}` };
    }
    const dest = join(worktreePath, relFromReadRoot);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }

  return { ok: true, specPath: relSpecPath };
}
