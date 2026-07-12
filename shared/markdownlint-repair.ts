import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AsyncSubprocessError, type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "./subprocess.ts";

export function keepIssueReferencesOffLineStart(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^#\d+\s*$/.test(line)) lines[i] = `See: ${line}`;
  }
  return lines.join("\n");
}

export function resolveHarnessRoot(override?: string | null): string | null {
  if (override !== undefined) return override;
  let current = import.meta.dir;
  for (let depth = 0; depth < 10; depth += 1) {
    if (
      existsSync(join(current, "node_modules", "markdownlint-cli2")) &&
      existsSync(join(current, ".markdownlint-cli2.jsonc"))
    ) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function applyIssueReferenceGuard(path: string): void {
  const content = readFileSync(path, "utf8");
  const guarded = keepIssueReferencesOffLineStart(content);
  if (guarded !== content) writeFileSync(path, guarded, "utf8");
}

export async function runMarkdownlintAutofix(args: {
  files: string[];
  warn: (message: string) => void;
  harnessRootOverride?: string | null;
  runner?: AsyncSubprocessRunner;
}): Promise<void> {
  if (args.files.length === 0) return;
  const harnessRoot = resolveHarnessRoot(args.harnessRootOverride);
  if (harnessRoot === null) {
    args.warn("warning: could not locate markdownlint binary; skipping autofix\n");
    return;
  }
  const binaryPath = join(harnessRoot, "node_modules", "markdownlint-cli2", "markdownlint-cli2.js");
  const configPath = join(harnessRoot, ".markdownlint-cli2.jsonc");
  if (!existsSync(binaryPath)) {
    args.warn("warning: markdownlint binary not found; skipping autofix\n");
    return;
  }
  if (!existsSync(configPath)) {
    args.warn("warning: markdownlint config not found; skipping autofix\n");
    return;
  }
  try {
    await (args.runner ?? realAsyncSubprocessRunner).runAsync(
      "bun",
      [binaryPath, "--fix", "--config", configPath, ...args.files],
      harnessRoot,
    );
  } catch (err) {
    const spawnError = err as NodeJS.ErrnoException & { status?: number | null };
    if (typeof spawnError.status === "number") return;
    if (spawnError.code === "ENOENT" || (err instanceof AsyncSubprocessError && err.code === "ENOENT")) {
      args.warn("warning: bun executable not found; skipping markdownlint autofix\n");
      return;
    }
    args.warn(`warning: could not run markdownlint autofix (${spawnError.code ?? "spawn failed"}); skipping autofix\n`);
  }
}
