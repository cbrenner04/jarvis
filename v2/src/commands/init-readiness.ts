import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { LoadError } from "../config/agent-model-config.ts";
import { loadMachineProfileModels } from "../config/machine-profile-loader.ts";
import { getDaemonStatus } from "../daemon/daemon-lifecycle.ts";
import { DAEMON_PID_PATH, DAEMON_SOCKET_PATH } from "../paths.ts";

/** Fixed, single-line readiness report: identifiers, statuses, requiredness, and rendering. */
export const READINESS_CHECK_ORDER = [
  "bun",
  "github-auth",
  "agents",
  "machine-profile",
  "project-registration",
  "origin",
  "spec-directory",
  "daemon",
] as const;

export type ReadinessCheckId = (typeof READINESS_CHECK_ORDER)[number];
export type ReadinessStatus = "ok" | "missing" | "warn";
export type ReadinessResult = { id: ReadinessCheckId; status: ReadinessStatus; detail?: string };

const REQUIRED_READINESS_CHECKS = new Set<ReadinessCheckId>([
  "bun",
  "github-auth",
  "agents",
  "machine-profile",
  "project-registration",
  "origin",
]);

export function isReadinessCheckRequired(id: ReadinessCheckId): boolean {
  return REQUIRED_READINESS_CHECKS.has(id);
}

export function readinessExitCode(results: readonly ReadinessResult[]): number {
  return results.some((result) => isReadinessCheckRequired(result.id) && result.status !== "ok") ? 1 : 0;
}

/** Restores canonical `READINESS_CHECK_ORDER` regardless of the order evaluation produced results in. */
function orderReadinessResults(results: readonly ReadinessResult[]): ReadinessResult[] {
  return READINESS_CHECK_ORDER.flatMap((id) => results.filter((result) => result.id === id));
}

export function renderReadinessReport(results: readonly ReadinessResult[]): string {
  const ordered = orderReadinessResults(results);
  return ordered
    .map((result) =>
      result.detail === undefined ? `${result.id} ${result.status}` : `${result.id} ${result.status}: ${result.detail}`,
    )
    .map((line) => `${line}\n`)
    .join("");
}

/** Collapses untrusted probe output to one trimmed, non-empty line. */
function normalizeDetail(value: string): string {
  const line = value.split(/\r?\n/).find((part) => part.trim().length > 0) ?? "";
  return line.trim();
}

function errorDetail(error: unknown): string {
  return normalizeDetail(error instanceof Error ? error.message : String(error));
}

type CheckOutcome = { status: ReadinessStatus; detail?: string };

function ok(): CheckOutcome {
  return { status: "ok" };
}

function missing(detail: string): CheckOutcome {
  return { status: "missing", detail };
}

function warn(detail: string): CheckOutcome {
  return { status: "warn", detail };
}

/** Every probe is wrapped so an exception, timeout, or multiline diagnostic becomes this check's
 * result instead of escaping the report. */
async function safeCheck(id: ReadinessCheckId, run: () => Promise<CheckOutcome>): Promise<ReadinessResult> {
  try {
    const outcome = await run();
    return outcome.detail === undefined
      ? { id, status: outcome.status }
      : { id, status: outcome.status, detail: normalizeDetail(outcome.detail) };
  } catch (error) {
    return { id, status: "missing", detail: errorDetail(error) };
  }
}

export type ReadinessContext = {
  machinesDir: string;
  profile: string;
  /** Whether a machine profile is actually configured (persisted), distinct from a `--check`
   * selector merely identifying one to probe. Defaults to configured (`true`) when omitted, since
   * setup always writes or already has one before evaluating readiness. */
  profileConfigured?: boolean;
  agents: readonly string[];
  isExecutable: (name: string) => boolean;
  projectRoot: string;
  projectRegistered: boolean;
  storedOrigin: string | undefined;
  targetDir: string;
};

export type ReadinessProbes = {
  checkBunRuntime?: () => Promise<{ ok: boolean; detail?: string }>;
  checkGithubAuth?: () => Promise<{ ok: boolean; detail?: string }>;
  currentOrigin?: (projectRoot: string) => Promise<string | undefined>;
  directoryExists?: (path: string) => boolean;
  checkDaemon?: () => Promise<{ state: "running" | "stale" | "stopped" }>;
};

async function defaultCheckBunRuntime(): Promise<{ ok: boolean; detail?: string }> {
  return Bun.which("bun") !== null ? { ok: true } : { ok: false, detail: "bun binary not found on PATH" };
}

async function defaultCheckGithubAuth(): Promise<{ ok: boolean; detail?: string }> {
  try {
    await realAsyncSubprocessRunner.runAsync("gh", ["auth", "status"], process.cwd(), { timeoutMs: 5_000 });
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: errorDetail(error) };
  }
}

async function defaultCurrentOrigin(projectRoot: string): Promise<string | undefined> {
  try {
    const stdout = await realAsyncSubprocessRunner.runAsync("git", ["remote", "get-url", "origin"], projectRoot, {
      timeoutMs: 5_000,
    });
    const origin = stdout.trim();
    return origin.length > 0 ? origin : undefined;
  } catch {
    return undefined;
  }
}

function defaultDirectoryExists(path: string): boolean {
  return existsSync(path);
}

function readDaemonPid(pidPath: string): number | null {
  if (!existsSync(pidPath)) return null;
  const raw = readFileSync(pidPath, "utf8").trim();
  if (raw.length === 0) return null;
  const pid = Number.parseInt(raw, 10);
  return Number.isNaN(pid) ? null : pid;
}

async function defaultCheckDaemon(): Promise<{ state: "running" | "stale" | "stopped" }> {
  const pid = readDaemonPid(DAEMON_PID_PATH);
  if (pid === null) return { state: "stopped" };
  try {
    return await getDaemonStatus(pid, DAEMON_SOCKET_PATH);
  } catch {
    return { state: "stopped" };
  }
}

/** Evaluates every readiness check, in report order, from already-resolved setup context plus
 * bounded, injectable probes. Read-only: never mutates config or repository state. */
export async function evaluateReadiness(
  context: ReadinessContext,
  probes: ReadinessProbes = {},
): Promise<ReadinessResult[]> {
  const checkBunRuntime = probes.checkBunRuntime ?? defaultCheckBunRuntime;
  const checkGithubAuth = probes.checkGithubAuth ?? defaultCheckGithubAuth;
  const currentOrigin = probes.currentOrigin ?? defaultCurrentOrigin;
  const directoryExists = probes.directoryExists ?? defaultDirectoryExists;
  const checkDaemon = probes.checkDaemon ?? defaultCheckDaemon;

  const results: ReadinessResult[] = [];

  results.push(
    await safeCheck("bun", async () => {
      const outcome = await checkBunRuntime();
      return outcome.ok ? ok() : missing(outcome.detail ?? "bun binary not found on PATH");
    }),
  );

  results.push(
    await safeCheck("github-auth", async () => {
      const outcome = await checkGithubAuth();
      return outcome.ok ? ok() : missing(outcome.detail ?? "gh auth status failed");
    }),
  );

  results.push(
    await safeCheck("agents", async () => {
      if (context.agents.length === 0) return missing("no configured agents");
      const unrunnable = context.agents.filter((agent) => !context.isExecutable(agent));
      return unrunnable.length === 0 ? ok() : missing(`not runnable on PATH: ${unrunnable.join(", ")}`);
    }),
  );

  results.push(
    await safeCheck("machine-profile", async () => {
      if (context.profileConfigured === false) return missing("machine profile is not configured");
      const modelConfig = loadMachineProfileModels(context.profile, context.agents, {
        machinesDir: context.machinesDir,
      });
      if (Array.isArray((modelConfig as LoadError).errors)) {
        return missing((modelConfig as LoadError).errors.join("; "));
      }
      return ok();
    }),
  );

  results.push(
    await safeCheck("project-registration", async () => {
      return context.projectRegistered ? ok() : missing(`'${context.projectRoot}' is not registered`);
    }),
  );

  results.push(
    await safeCheck("origin", async () => {
      const current = await currentOrigin(context.projectRoot);
      if (current === undefined) return missing("no current origin configured");
      if (context.storedOrigin === undefined) return missing("no stored origin registered");
      const originMatches = current === context.storedOrigin;
      return originMatches ? ok() : warn(`stored origin '${context.storedOrigin}' does not match current '${current}'`);
    }),
  );

  results.push(
    await safeCheck("spec-directory", async () => {
      const path = join(context.projectRoot, context.targetDir);
      return directoryExists(path) ? ok() : missing(`'${context.targetDir}' does not exist`);
    }),
  );

  results.push(
    await safeCheck("daemon", async () => {
      const status = await checkDaemon();
      if (status.state === "running") return ok();
      if (status.state === "stale") return warn("daemon loaded revision is stale");
      return missing("daemon is not running");
    }),
  );

  return results;
}
