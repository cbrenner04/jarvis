import { execFileSync, execSync } from "node:child_process";
import { normalizeRepoUrl } from "./repo-url.ts";

/** Normalized CI check name and status used by triage and review-feedback classification. */
export type CiCheckState = { name: string; status: string };

/** Raw GitHub commit check-run fields needed for classification and excerpt collection. */
export type CiCheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
  output?: {
    summary?: string;
    text?: string;
  };
};

export type CiCheckClassification = "green" | "pending" | "red";

/** Discriminated HEAD-sha check-runs fetch result; hard failures are not classifiable check data. */
export type CommitCheckRunsFetchResult = { ok: true; checkRuns: CiCheckRun[] } | { ok: false; reason: string };

export type FailingCiCheck = {
  name: string;
  excerpt: string;
};

export type FetchCommitCheckRunsDeps = {
  execSync?: typeof execSync;
  execFileSync?: typeof execFileSync;
};

const CI_GREEN_STATUSES = new Set(["success", "skipped", "neutral"]);
const CI_PENDING_STATUSES = new Set(["pending", "queued", "in_progress", "action_required", "stale"]);
const CI_RED_STATUSES = new Set(["failure", "cancelled", "timed_out", "startup_failure"]);

const CI_EXCERPT_MAX_BYTES = 2048;
const NO_EXCERPT = "(no excerpt available)";

/**
 * Classify adapted CI checks as green, pending, or red using triage `--merge` vocabulary.
 * Invariant: `null` or empty input fail-closes to red with `failingCheck: "no checks found"`.
 */
export function classifyCiChecks(checks: CiCheckState[] | null): {
  classification: CiCheckClassification;
  failingCheck?: string;
  pendingCheck?: string;
} {
  if (!checks || checks.length === 0) {
    return { classification: "red", failingCheck: "no checks found" };
  }

  let failingCheck: string | undefined;
  let pendingCheck: string | undefined;

  for (const check of checks) {
    if (CI_RED_STATUSES.has(check.status)) {
      failingCheck ??= check.name;
    } else if (CI_PENDING_STATUSES.has(check.status)) {
      pendingCheck ??= check.name;
    } else if (!CI_GREEN_STATUSES.has(check.status)) {
      failingCheck ??= check.name;
    }
  }

  if (failingCheck !== undefined) {
    return { classification: "red", failingCheck };
  }
  if (pendingCheck !== undefined) {
    return { classification: "pending", pendingCheck };
  }
  return { classification: "green" };
}

/**
 * Map GitHub commit check-run `status` + `conclusion` into `CiCheckState[]` for `classifyCiChecks`.
 */
export function adaptCheckRunsToCiStates(
  checkRuns: { name: string; status: string; conclusion: string | null }[],
): CiCheckState[] {
  return checkRuns.map((run) => {
    const status = run.status.toLowerCase();
    let mapped: string;
    if (status === "completed") {
      mapped = run.conclusion === null ? "pending" : run.conclusion.toLowerCase();
    } else {
      mapped = status;
    }
    return { name: run.name, status: mapped };
  });
}

/**
 * Paginated HEAD-sha commit check-runs fetch via `gh api`.
 * Returns `{ ok: false }` on gh API error, unresolvable `origin`, JSON/parse failure, or pagination abort.
 */
export function fetchCommitCheckRunsForSha(
  worktreePath: string,
  sha: string,
  deps: FetchCommitCheckRunsDeps = {},
): CommitCheckRunsFetchResult {
  const execSyncFn = deps.execSync ?? execSync;
  const execFileSyncFn = deps.execFileSync ?? execFileSync;

  const ownerRepo = resolveOwnerRepoFromWorktree(worktreePath, execFileSyncFn);
  if (ownerRepo === null) {
    return { ok: false, reason: "unresolvable origin remote" };
  }
  const { owner, repo } = ownerRepo;

  try {
    const checkRuns: CiCheckRun[] = [];
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let output: string;
      try {
        output = execSyncFn(`gh api "repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}"`, {
          stdio: "pipe",
          encoding: "utf8",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, reason: `gh api error: ${message}` };
      }

      let data: { check_runs?: unknown };
      try {
        data = JSON.parse(output) as { check_runs?: unknown };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, reason: `check-runs JSON parse failure: ${message}` };
      }

      if (!Array.isArray(data.check_runs)) {
        return { ok: false, reason: "check-runs response missing check_runs array" };
      }
      if (data.check_runs.length === 0) {
        break;
      }

      for (const rawEntry of data.check_runs) {
        if (typeof rawEntry !== "object" || rawEntry === null) {
          continue;
        }
        const run = rawEntry as {
          name?: unknown;
          status?: unknown;
          conclusion?: unknown;
          output?: unknown;
        };
        if (typeof run.name !== "string" || typeof run.status !== "string") {
          continue;
        }
        const parsedOutput = parseCheckRunOutput(run.output);
        const entry: CiCheckRun = {
          name: run.name,
          status: run.status,
          conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
        };
        if (parsedOutput !== undefined) {
          entry.output = parsedOutput;
        }
        checkRuns.push(entry);
      }

      if (data.check_runs.length < 100) {
        break;
      }
      page += 1;
    }
    return { ok: true, checkRuns };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `check-runs pagination abort: ${message}` };
  }
}

/**
 * Triage flake-recovery compatibility: adapted states, or `null` when fetch hard-fails.
 * `classifyCiChecks(null)` fail-closes to red — callers must not confuse that with fetch errors on the review-feedback path.
 */
export function fetchCommitChecksForSha(
  worktreePath: string,
  sha: string,
  deps: FetchCommitCheckRunsDeps = {},
): CiCheckState[] | null {
  const result = fetchCommitCheckRunsForSha(worktreePath, sha, deps);
  if (!result.ok) {
    return null;
  }
  return adaptCheckRunsToCiStates(result.checkRuns);
}

/**
 * Collect every red-classified check from a successful fetch payload with bounded output excerpts.
 * Invariant: no second gh call; operates only on `fetchResult.checkRuns`.
 */
export function collectFailingCiContext(fetchResult: { ok: true; checkRuns: CiCheckRun[] }): FailingCiCheck[] {
  const states = adaptCheckRunsToCiStates(fetchResult.checkRuns);
  const failing: FailingCiCheck[] = [];

  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    const run = fetchResult.checkRuns[index];
    if (state === undefined || run === undefined || !isRedCiStatus(state.status)) {
      continue;
    }
    failing.push({
      name: state.name,
      excerpt: buildCheckExcerpt(run.output),
    });
  }

  return failing;
}

function isRedCiStatus(status: string): boolean {
  if (CI_RED_STATUSES.has(status)) {
    return true;
  }
  if (CI_PENDING_STATUSES.has(status) || CI_GREEN_STATUSES.has(status)) {
    return false;
  }
  return true;
}

function buildCheckExcerpt(output: CiCheckRun["output"]): string {
  const summary = output?.summary?.trim();
  const text = output?.text?.trim();
  if (summary === undefined && text === undefined) {
    return NO_EXCERPT;
  }
  if (summary !== undefined && text !== undefined) {
    return capExcerptTail(`${summary}\n${text}`);
  }
  return capExcerptTail(summary ?? text ?? NO_EXCERPT);
}

function capExcerptTail(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= CI_EXCERPT_MAX_BYTES) {
    return text;
  }
  return new TextDecoder().decode(bytes.slice(-CI_EXCERPT_MAX_BYTES));
}

function parseCheckRunOutput(output: unknown): CiCheckRun["output"] | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }
  const record = output as { summary?: unknown; text?: unknown };
  const summary = typeof record.summary === "string" ? record.summary : undefined;
  const text = typeof record.text === "string" ? record.text : undefined;
  if (summary === undefined && text === undefined) {
    return undefined;
  }
  const parsed: NonNullable<CiCheckRun["output"]> = {};
  if (summary !== undefined) {
    parsed.summary = summary;
  }
  if (text !== undefined) {
    parsed.text = text;
  }
  return parsed;
}

function resolveOwnerRepoFromWorktree(
  worktreePath: string,
  execFileSyncFn: typeof execFileSync,
): { owner: string; repo: string } | null {
  try {
    const origin = execFileSyncFn("git", ["remote", "get-url", "origin"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    const [, owner, repo] = normalizeRepoUrl(origin)?.split("/") ?? [];
    return owner !== undefined && repo !== undefined ? { owner, repo } : null;
  } catch {
    return null;
  }
}
