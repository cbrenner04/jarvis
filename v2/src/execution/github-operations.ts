import { spawn } from "node:child_process";
import { errorMessage } from "../../../shared/error-message.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessOptions,
  type AsyncSubprocessRunner,
  isSubprocessTimeout,
  NETWORK_SUBPROCESS_TIMEOUT_MS,
  networkSubprocessOptions,
  nonInteractiveNetworkEnv,
} from "../../../shared/subprocess.ts";

// ---------------------------------------------------------------------------
// GitHub operations boundary. Jarvis-owned code constructs no `gh` commands outside this
// file: callers pass semantic arguments (branch, PR number, base) and get typed results or a
// `GitHubOperationError`. Every operation takes an injected `AsyncSubprocessRunner` so callers
// test against a fake and never reach the ambient CLI. Queries (listPrs, viewPr, viewPrState,
// viewPrReviewActivity, repoIdentity, graphql, checkAuthStatus) are stateless; mutations
// (createPr, markPrReady, undoPrReady, closePr, mergePr, commentPr) document idempotency inline.
// ---------------------------------------------------------------------------

export type GitHubOperation =
  | "pr-list"
  | "pr-view"
  | "pr-create"
  | "pr-ready"
  | "pr-ready-undo"
  | "pr-close"
  | "pr-merge"
  | "pr-comment"
  | "pr-edit"
  | "repo-view"
  | "graphql"
  | "auth-status";

/**
 * Why an operation failed. `timeout`, `network` (transport: DNS, connect, reset, TLS),
 * `service` (GitHub 5xx / "Something went wrong"), and `rate-limited` (429 / "rate limit") are
 * retryable; the rest are fatal for the attempt: `aborted` is the caller's own cancellation,
 * `auth` a 401/403 or missing login, `not-found` a 404 or "no pull requests found", `no-commits`
 * a PR create with nothing between base and head, `failed` any other non-zero exit or malformed
 * output (no classification: `publication-retry` falls back to its text heuristics).
 */
export type GitHubFailureReason =
  | "timeout"
  | "aborted"
  | "network"
  | "service"
  | "rate-limited"
  | "auth"
  | "not-found"
  | "no-commits"
  | "failed";

const RETRYABLE_REASONS: ReadonlySet<GitHubFailureReason> = new Set(["timeout", "network", "service", "rate-limited"]);

/**
 * `message` is the underlying `gh` message verbatim (callers surface it to operators);
 * classification lives in `operation` / `reason`, and retry policy keys off `retryable`.
 */
export class GitHubOperationError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly operation: GitHubOperation,
    readonly reason: GitHubFailureReason,
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly status: number | undefined,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GitHubOperationError";
    this.retryable = RETRYABLE_REASONS.has(reason);
  }
}

/** True when `error` is a `GitHubOperationError` worth retrying (timeout, network, 5xx, or rate limit). */
export function isRetryableGitHubError(error: unknown): boolean {
  return error instanceof GitHubOperationError && error.retryable;
}

type Failure = { message: string; stdout: string; stderr: string; status: number | undefined; timeout: boolean };

function textOf(value: unknown): string {
  return typeof value === "string" ? value : value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : "";
}

/** Normalizes an async (`AsyncSubprocessError`) or execFile-shaped rejection. */
function failureOf(error: unknown): Failure {
  if (error instanceof AsyncSubprocessError) {
    return {
      message: error.message,
      stdout: error.stdout,
      stderr: error.stderr,
      status: error.status,
      timeout: isSubprocessTimeout(error),
    };
  }
  const shaped = error as { stdout?: unknown; stderr?: unknown; status?: unknown; code?: unknown } | null;
  const status =
    typeof shaped?.status === "number" ? shaped.status : typeof shaped?.code === "number" ? shaped.code : undefined;
  return {
    message: errorMessage(error),
    stdout: textOf(shaped?.stdout),
    stderr: textOf(shaped?.stderr),
    status,
    timeout: shaped?.code === "ETIMEDOUT",
  };
}

type ReasonRule = readonly [RegExp, GitHubFailureReason];

/**
 * Ordered: rate limit first (gh reports it as a 403/"forbidden", which would read as auth), then
 * auth (a 403 also mentions the resource), not-found (gh's own phrasings only: a bare "not found"
 * appears in unrelated messages), precondition, 5xx, transport.
 */
const REASON_RULES: readonly ReasonRule[] = [
  [/rate limit|HTTP 429|\b429\b/i, "rate-limited"],
  [
    /HTTP 401|HTTP 403|not logged in|gh auth login|bad credentials|authentication (?:failed|required)|permission denied|resource not accessible|forbidden/i,
    "auth",
  ],
  [/HTTP 404|no pull requests found|could not resolve to a/i, "not-found"],
  [/no commits between/i, "no-commits"],
  [/HTTP 5\d\d|something went wrong|server error|bad gateway|service unavailable|gateway time-?out/i, "service"],
  [
    /could not resolve host|no such host|connection refused|connection reset|network is unreachable|dial tcp|i\/o timeout|tls handshake|error connecting to|unexpected eof/i,
    "network",
  ],
];

export type GitHubOperationOptions = { signal?: AbortSignal | undefined; timeoutMs?: number | undefined };

/** Maps a runner rejection to `GitHubOperationError`: timeout/abort first, then `REASON_RULES` against message+stderr, else `failed`. */
function ghError(operation: GitHubOperation, error: unknown, options: GitHubOperationOptions): GitHubOperationError {
  const failure = failureOf(error);
  const text = `${failure.message}\n${failure.stderr}`;
  const reason: GitHubFailureReason = failure.timeout
    ? "timeout"
    : options.signal?.aborted
      ? "aborted"
      : (REASON_RULES.find(([pattern]) => pattern.test(text))?.[1] ?? "failed");
  return new GitHubOperationError(operation, reason, failure.message, failure.stdout, failure.stderr, failure.status, {
    cause: error,
  });
}

function malformed(operation: GitHubOperation, message: string, stdout: string): GitHubOperationError {
  return new GitHubOperationError(operation, "failed", message, stdout, "", undefined);
}

function runOptions(options: GitHubOperationOptions): AsyncSubprocessOptions {
  const base = networkSubprocessOptions({ signal: options.signal });
  return options.timeoutMs !== undefined ? { ...base, timeoutMs: options.timeoutMs } : base;
}

async function gh(
  runner: AsyncSubprocessRunner,
  cwd: string,
  operation: GitHubOperation,
  args: string[],
  options: GitHubOperationOptions,
): Promise<string> {
  try {
    return await runner.runAsync("gh", args, cwd, runOptions(options));
  } catch (error) {
    throw ghError(operation, error, options);
  }
}

function parseJson(operation: GitHubOperation, stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw malformed(operation, `gh ${operation} returned non-JSON output`, stdout);
  }
}

/** The raw gh seam publication fixtures inject: `(cwd, args, options)`, with `options` the bounded run options the boundary resolved. */
export type GhCommandSeam = (cwd: string, args: readonly string[], options: AsyncSubprocessOptions) => Promise<string>;

/** Adapts a raw gh seam to the runner interface; the bounded options (network timeout, non-interactive env, abort signal) reach the seam. */
export function ghCommandRunner(command: GhCommandSeam): AsyncSubprocessRunner {
  return { runAsync: (_cmd, args, cwd, options = {}) => command(cwd, args, options) };
}

// --- PR queries ----------------------------------------------------------------

type PrState = "OPEN" | "CLOSED" | "MERGED";

function prStateOf(value: unknown): PrState | undefined {
  return value === "OPEN" || value === "CLOSED" || value === "MERGED" ? value : undefined;
}

type PrSelector = number | string;

/** A `gh pr list` row. Optional fields are those gh's schema allows to be null; `number` and `baseRefName` are always present. */
export type PrListEntry = {
  number: number;
  baseRefName: string;
  url?: string;
  isDraft?: boolean;
  state?: PrState;
  headRefOid?: string;
  mergedAt?: string | null;
};

const PR_LIST_FIELDS = "number,url,baseRefName,isDraft,state,headRefOid,mergedAt";

function prListEntryOf(row: unknown, stdout: string): PrListEntry {
  const record = (row ?? {}) as Record<string, unknown>;
  if (typeof record.number !== "number" || typeof record.baseRefName !== "string") {
    throw malformed("pr-list", `gh pr list row missing number/baseRefName: ${JSON.stringify(row)}`, stdout);
  }
  const state = prStateOf(record.state);
  return {
    number: record.number,
    baseRefName: record.baseRefName,
    ...(typeof record.url === "string" ? { url: record.url } : {}),
    ...(typeof record.isDraft === "boolean" ? { isDraft: record.isDraft } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(typeof record.headRefOid === "string" ? { headRefOid: record.headRefOid } : {}),
    ...(record.mergedAt === null || typeof record.mergedAt === "string" ? { mergedAt: record.mergedAt } : {}),
  };
}

/** PRs whose head is `branch`, newest first as gh orders them; `state: "all"` includes closed and merged history. */
export async function listPrs(
  runner: AsyncSubprocessRunner,
  cwd: string,
  query: { branch: string; state: "open" | "all" },
  options: GitHubOperationOptions = {},
): Promise<PrListEntry[]> {
  const stdout = await gh(
    runner,
    cwd,
    "pr-list",
    ["pr", "list", "--head", query.branch, "--state", query.state, "--json", PR_LIST_FIELDS],
    options,
  );
  const rows = parseJson("pr-list", stdout);
  if (!Array.isArray(rows)) throw malformed("pr-list", "gh pr list returned a non-array", stdout);
  return rows.map((row) => prListEntryOf(row, stdout));
}

type PrIdentity = { number: number; url: string; baseRefName: string };

/** Identity of one PR by number, or gh's own pick for a branch name (honors no state filter: prefer a number). */
export async function viewPr(
  runner: AsyncSubprocessRunner,
  cwd: string,
  selector: PrSelector,
  options: GitHubOperationOptions = {},
): Promise<PrIdentity> {
  const stdout = await gh(
    runner,
    cwd,
    "pr-view",
    ["pr", "view", String(selector), "--json", "number,url,baseRefName"],
    options,
  );
  const record = (parseJson("pr-view", stdout) ?? {}) as Record<string, unknown>;
  if (typeof record.number !== "number" || typeof record.url !== "string" || typeof record.baseRefName !== "string") {
    throw malformed("pr-view", `gh pr view ${String(selector)} returned an incomplete record`, stdout);
  }
  return { number: record.number, url: record.url, baseRefName: record.baseRefName };
}

type PrStateView = {
  state: PrState;
  merged: boolean;
  mergedAt: string | null;
  isCrossRepository?: boolean;
};

/** Open/closed/merged state of a PR; `merged` is true only for `MERGED` and `mergedAt` is then set. */
export async function viewPrState(
  runner: AsyncSubprocessRunner,
  cwd: string,
  selector: PrSelector,
  options: GitHubOperationOptions = {},
): Promise<PrStateView> {
  const stdout = await gh(
    runner,
    cwd,
    "pr-view",
    ["pr", "view", String(selector), "--json", "state,mergedAt,isCrossRepository"],
    options,
  );
  const record = (parseJson("pr-view", stdout) ?? {}) as Record<string, unknown>;
  const state = prStateOf(record.state);
  if (state === undefined) {
    throw malformed(
      "pr-view",
      `unexpected gh pr view state for ${String(selector)}: ${JSON.stringify(record.state)}`,
      stdout,
    );
  }
  const mergedAt = typeof record.mergedAt === "string" ? record.mergedAt : null;
  const isCrossRepository = typeof record.isCrossRepository === "boolean" ? record.isCrossRepository : undefined;
  return {
    state,
    merged: state === "MERGED",
    mergedAt,
    ...(isCrossRepository !== undefined ? { isCrossRepository } : {}),
  };
}

export type PrReviewActivity = {
  reviews?: Array<{
    id?: string | number | null;
    author?: { login?: string | null } | null;
    body?: string | null;
    submittedAt?: string | null;
    state?: string | null;
  }>;
  comments?: Array<{
    id?: string | null;
    author?: { login?: string | null } | null;
    body?: string | null;
    createdAt?: string | null;
  }>;
};

/** One PR field (`body` or `title`) by branch name or number. */
export async function viewPrTextField(
  runner: AsyncSubprocessRunner,
  cwd: string,
  selector: PrSelector,
  field: "body" | "title",
  options: GitHubOperationOptions = {},
): Promise<string> {
  return await gh(
    runner,
    cwd,
    "pr-view",
    ["pr", "view", String(selector), "--json", field, "-q", `.${field}`],
    options,
  );
}

export type PrAdmissionView = {
  state?: PrState;
  headRefName?: string;
  url?: string;
  isDraft?: boolean;
  reviews?: Array<{ submittedAt?: string | null }>;
};

/** Admission prelude fields for an open PR by number. */
export async function viewPrAdmission(
  runner: AsyncSubprocessRunner,
  cwd: string,
  prNumber: number,
  options: GitHubOperationOptions = {},
): Promise<PrAdmissionView> {
  const stdout = await gh(
    runner,
    cwd,
    "pr-view",
    ["pr", "view", String(prNumber), "--json", "state,headRefName,url,reviews,isDraft"],
    options,
  );
  const record = parseJson("pr-view", stdout);
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw malformed("pr-view", `gh pr view ${prNumber} admission fields returned a non-object`, stdout);
  }
  return record as PrAdmissionView;
}

/** Reviews and top-level comments on a PR, as gh reports them (nullable fields preserved). */
export async function viewPrReviewActivity(
  runner: AsyncSubprocessRunner,
  cwd: string,
  prNumber: number,
  options: GitHubOperationOptions = {},
): Promise<PrReviewActivity> {
  const stdout = await gh(
    runner,
    cwd,
    "pr-view",
    ["pr", "view", String(prNumber), "--json", "reviews,comments"],
    options,
  );
  const record = parseJson("pr-view", stdout);
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw malformed("pr-view", `gh pr view ${prNumber} reviews,comments returned a non-object`, stdout);
  }
  return record as PrReviewActivity;
}

// --- PR mutations --------------------------------------------------------------

type CreatePrInput = { base: string; title: string; body: string; draft: boolean };
/** `url` is gh's printed PR URL when it printed one; `number` is parsed from it so callers confirm by number, never by branch. */
type CreatePrResult = { url: string | undefined; number: number | undefined };

/**
 * Opens a PR from the current branch. Not idempotent: a second create on the same head fails
 * (`failed`); callers resolve the existing PR with `listPrs` first. Nothing to publish is `no-commits`.
 */
export async function createPr(
  runner: AsyncSubprocessRunner,
  cwd: string,
  input: CreatePrInput,
  options: GitHubOperationOptions = {},
): Promise<CreatePrResult> {
  const args = ["pr", "create"];
  if (input.draft) args.push("--draft");
  args.push("--base", input.base, "--title", input.title, "--body", input.body);
  const stdout = (await gh(runner, cwd, "pr-create", args, options)).trim();
  const url = /^https?:\/\//.test(stdout) ? stdout : undefined;
  const number = url === undefined ? undefined : /\/pull\/(\d+)\/?$/.exec(url)?.[1];
  return { url, number: number === undefined ? undefined : Number(number) };
}

/** Flips a draft to ready for review. Idempotent: gh exits 0 on an already-ready PR. */
export async function markPrReady(
  runner: AsyncSubprocessRunner,
  cwd: string,
  selector: PrSelector,
  options: GitHubOperationOptions = {},
): Promise<void> {
  await gh(runner, cwd, "pr-ready", ["pr", "ready", String(selector)], options);
}

/** Converts a ready PR back to draft. Idempotent: gh exits 0 on an already-draft PR. */
export async function undoPrReady(
  runner: AsyncSubprocessRunner,
  cwd: string,
  prNumber: number,
  options: GitHubOperationOptions = {},
): Promise<void> {
  await gh(runner, cwd, "pr-ready-undo", ["pr", "ready", "--undo", String(prNumber)], options);
}

type ClosePrResult = { status: "closed" } | { status: "already-closed" };

/** Closes a PR without merging. Idempotent: an already-closed (or merged) PR is `already-closed`, not an error. */
export async function closePr(
  runner: AsyncSubprocessRunner,
  cwd: string,
  prNumber: number,
  options: GitHubOperationOptions = {},
): Promise<ClosePrResult> {
  try {
    await gh(runner, cwd, "pr-close", ["pr", "close", String(prNumber)], options);
    return { status: "closed" };
  } catch (error) {
    if (
      error instanceof GitHubOperationError &&
      /already (?:closed|merged)/i.test(`${error.message}\n${error.stderr}`)
    ) {
      return { status: "already-closed" };
    }
    throw error;
  }
}

/** Merges a PR with the repository's default strategy. Not idempotent: a merged PR fails (`failed`); probe `viewPrState` first. */
export async function mergePr(
  runner: AsyncSubprocessRunner,
  cwd: string,
  selector: PrSelector,
  options: GitHubOperationOptions = {},
): Promise<void> {
  await gh(runner, cwd, "pr-merge", ["pr", "merge", String(selector)], options);
}

/** Posts a top-level PR comment. Not idempotent: each call adds a comment. */
export async function commentPr(
  runner: AsyncSubprocessRunner,
  cwd: string,
  prNumber: number,
  body: string,
  options: GitHubOperationOptions = {},
): Promise<void> {
  await gh(runner, cwd, "pr-comment", ["pr", "comment", String(prNumber), "--body", body], options);
}

/** `gh pr edit <selector> --title <title>`. */
export async function editPrTitle(
  runner: AsyncSubprocessRunner,
  cwd: string,
  selector: PrSelector,
  title: string,
  options: GitHubOperationOptions = {},
): Promise<void> {
  await gh(runner, cwd, "pr-edit", ["pr", "edit", String(selector), "--title", title], options);
}

/** Stdin-fed `gh pr edit --body-file -` with a network bound (matches publication refresh semantics). */
export async function editPrBodyFromStdin(
  cwd: string,
  selector: PrSelector,
  body: string,
  options: GitHubOperationOptions & { ghCommand?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? NETWORK_SUBPROCESS_TIMEOUT_MS;
  const args = ["pr", "edit", String(selector), "--body-file", "-"];
  const command = options.ghCommand ?? "gh";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: nonInteractiveNetworkEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdin?.on("error", () => {});
    child.stdin?.write(body);
    child.stdin?.end();
    let stderr = "";
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(ghError("pr-edit", error, options));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new GitHubOperationError(
            "pr-edit",
            "timeout",
            `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
            "",
            stderr,
            undefined,
          ),
        );
      } else if (code === 0) resolve();
      else
        reject(
          new GitHubOperationError(
            "pr-edit",
            "failed",
            stderr.trim() || `gh pr edit exited ${code ?? "unknown"}`,
            "",
            stderr,
            code ?? undefined,
          ),
        );
    });
  });
}

// --- Repository and session queries ----------------------------------------------

type RepoIdentity = { owner: string; name: string };

/** `owner/name` of the repository `cwd` belongs to. */
export async function repoIdentity(
  runner: AsyncSubprocessRunner,
  cwd: string,
  options: GitHubOperationOptions = {},
): Promise<RepoIdentity> {
  const stdout = await gh(
    runner,
    cwd,
    "repo-view",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    options,
  );
  const value = stdout.trim();
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw malformed("repo-view", `invalid gh repo identity: ${JSON.stringify(value)}`, stdout);
  }
  return { owner: value.slice(0, slash), name: value.slice(slash + 1) };
}

type GraphqlQuery = { query: string; variables: Record<string, string | number> };

/** Runs a GraphQL query (`-f query`, typed `-F` variables) and returns the parsed response envelope. */
export async function graphql(
  runner: AsyncSubprocessRunner,
  cwd: string,
  input: GraphqlQuery,
  options: GitHubOperationOptions = {},
): Promise<unknown> {
  const args = ["api", "graphql", "-f", `query=${input.query}`];
  for (const [key, value] of Object.entries(input.variables)) args.push("-F", `${key}=${String(value)}`);
  return parseJson("graphql", await gh(runner, cwd, "graphql", args, options));
}

/** Resolves when `gh` has a usable login; rejects with reason `auth` ("not logged in") or `timeout` under `timeoutMs`. Runner and cwd are injected, never ambient. */
export async function checkAuthStatus(
  runner: AsyncSubprocessRunner,
  cwd: string,
  options: GitHubOperationOptions = {},
): Promise<void> {
  await gh(runner, cwd, "auth-status", ["auth", "status"], options);
}
