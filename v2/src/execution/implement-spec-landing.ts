import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

export type LandImplementSpecTreeInput = {
  worktreePath: string;
  specReadRoot: string;
  specPath: string;
};

export type LandImplementSpecTreeResult = { ok: true; specPath: string } | { ok: false; error: string };

function listMarkdownFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(path));
    } else if (entry.isFile() && path.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

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
    const message = error instanceof Error ? error.message : String(error);
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

  for (const src of listMarkdownFiles(specDir)) {
    const relFromReadRoot = relative(specReadRoot, src);
    if (relFromReadRoot.startsWith("..")) {
      return { ok: false, error: `implement.spec_landing_out_of_tree: ${src}` };
    }
    const dest = join(worktreePath, relFromReadRoot);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }

  // verdict-patch.md is already copied by the markdown loop above (it lives in specDir); no dedicated pass needed.
  return { ok: true, specPath: relSpecPath };
}
