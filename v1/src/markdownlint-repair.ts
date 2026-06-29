import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Prepend `See: ` to line-leading `#NNN` issue refs so MD018 autofix does not corrupt them. */
export function keepIssueReferencesOffLineStart(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^#\d+\s*$/.test(line)) {
      lines[i] = `See: ${line}`;
    }
  }
  return lines.join("\n");
}

/** Walk upward from `import.meta.dir` to find harness root with markdownlint-cli2 + config. */
export function resolveHarnessRoot(override?: string | null): string | null {
  if (override !== undefined) {
    return override;
  }
  let current = import.meta.dir;
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const markdownlintPath = join(current, "node_modules", "markdownlint-cli2");
    const configPath = join(current, ".markdownlint-cli2.jsonc");

    try {
      if (existsSync(markdownlintPath) && existsSync(configPath)) {
        return current;
      }
    } catch {
      // Continue
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
    depth += 1;
  }

  return null;
}

/** Apply MD018 guard to a file when line-leading issue refs are present. */
export function applyIssueReferenceGuard(path: string): void {
  const content = readFileSync(path, "utf8");
  const guarded = keepIssueReferencesOffLineStart(content);
  if (guarded !== content) {
    writeFileSync(path, guarded, "utf8");
  }
}

/**
 * Run pinned markdownlint-cli2 `--fix` on absolute file paths.
 * Ignores nonzero exit from residual violations; warns on spawn/config failures.
 */
export function runMarkdownlintAutofix(args: {
  files: string[];
  warn: (message: string) => void;
  harnessRootOverride?: string | null;
}): void {
  if (args.files.length === 0) {
    return;
  }

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
    execFileSync("bun", [binaryPath, "--fix", "--config", configPath, ...args.files], {
      cwd: harnessRoot,
      env: process.env,
      stdio: "pipe",
    });
  } catch (err) {
    const spawnError = err as NodeJS.ErrnoException & { status?: number | null };
    if (typeof spawnError.status === "number") {
      return;
    }
    if (spawnError.code === "ENOENT") {
      args.warn("warning: bun executable not found; skipping markdownlint autofix\n");
      return;
    }
    args.warn(
      `warning: could not run markdownlint autofix (${spawnError.code ?? "spawn failed"}); skipping autofix\n`,
    );
  }
}
