import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
  runSyncWithTimeout,
} from "./subprocess.ts";

export class FixCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixCommandError";
  }
}

const PACKAGE_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);

/** When tokens match `<pm> run [<flags>…] <script>`, return `<script>`; else `null`. */
export function parsePackageManagerRunScript(tokens: string[]): string | null {
  if (tokens.length < 3) {
    return null;
  }
  const [pm, run, ...rest] = tokens;
  if (pm === undefined || run === undefined || !PACKAGE_MANAGERS.has(pm) || run !== "run") {
    return null;
  }
  for (const token of rest) {
    if (!token.startsWith("-")) {
      return token;
    }
  }
  return null;
}

function packageJsonLacksScript(cwd: string, scriptName: string): boolean {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    return true;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, unknown> };
    return typeof pkg.scripts?.[scriptName] !== "string";
  } catch {
    return true;
  }
}

function resolveAutofixTokens(fixCommand: string | undefined): string[] {
  return fixCommand !== undefined ? fixCommand.trim().split(/\s+/) : ["bun", "run", "fix"];
}

function displayAutofixCommand(fixCommand: string | undefined): string {
  return fixCommand ?? "bun run fix";
}

function shouldSkipAutofixForAbsentScript(cwd: string, tokens: string[]): boolean {
  const scriptName = parsePackageManagerRunScript(tokens);
  return scriptName !== null && packageJsonLacksScript(cwd, scriptName);
}

export type RunFixCommandOpts = {
  cwd: string;
  fixCommand?: string;
  timeoutMs: number;
  agentLabel?: string;
};

type PreparedFixCommand = { kind: "skip" } | { kind: "run"; head: string; args: string[]; displayCmd: string };

function prepareFixCommand(opts: RunFixCommandOpts): PreparedFixCommand {
  const tokens = resolveAutofixTokens(opts.fixCommand);
  const displayCmd = displayAutofixCommand(opts.fixCommand);
  if (shouldSkipAutofixForAbsentScript(opts.cwd, tokens)) {
    return { kind: "skip" };
  }
  const [head, ...args] = tokens;
  if (head === undefined) {
    throw new FixCommandError(`invalid fix command: ${displayCmd}`);
  }
  return { kind: "run", head, args, displayCmd };
}

function isSyncExecTimeout(err: unknown): boolean {
  const out = err as NodeJS.ErrnoException & { signal?: NodeJS.Signals };
  return out.code === "ETIMEDOUT" && out.signal === "SIGTERM";
}

function isAsyncExecTimeout(err: unknown): boolean {
  return err instanceof AsyncSubprocessError && err.code === "ETIMEDOUT";
}

function toFixCommandError(displayCmd: string, opts: RunFixCommandOpts, err: unknown): FixCommandError {
  if (isSyncExecTimeout(err) || isAsyncExecTimeout(err)) {
    return new FixCommandError(`${displayCmd} exceeded ${opts.timeoutMs}ms budget (gate: ${opts.agentLabel ?? ""})`);
  }
  const out = err as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string };
  const captured = [out.stdout?.toString(), out.stderr?.toString()].filter(Boolean).join("\n").trim();
  return new FixCommandError(captured ? `${displayCmd} failed:\n${captured}` : `${displayCmd} failed`);
}

/** Runs project autofix synchronously; skips absent package-manager scripts without error. */
export function runFixCommandSync(opts: RunFixCommandOpts): void {
  const prepared = prepareFixCommand(opts);
  if (prepared.kind === "skip") {
    return;
  }
  try {
    runSyncWithTimeout(prepared.head, prepared.args, {
      cwd: opts.cwd,
      env: { ...process.env },
      timeoutMs: opts.timeoutMs,
    });
  } catch (err) {
    throw toFixCommandError(prepared.displayCmd, opts, err);
  }
}

/** Runs project autofix asynchronously; skips absent package-manager scripts without error. */
export async function runFixCommand(
  opts: RunFixCommandOpts,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<void> {
  const prepared = prepareFixCommand(opts);
  if (prepared.kind === "skip") {
    return;
  }
  try {
    await runner.runAsync(prepared.head, prepared.args, opts.cwd, {
      timeoutMs: opts.timeoutMs,
      env: { ...process.env },
    });
  } catch (err) {
    throw toFixCommandError(prepared.displayCmd, opts, err);
  }
}
