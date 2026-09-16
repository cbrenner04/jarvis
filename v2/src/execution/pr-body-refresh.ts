import { spawn } from "node:child_process";
import { errorMessage } from "../../../shared/error-message.ts";
import {
  NETWORK_SUBPROCESS_TIMEOUT_MS,
  networkSubprocessOptions,
  nonInteractiveNetworkEnv,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { renderAttribution } from "./pr-attribution.ts";
import { formatPublicationSpecPathForPrBody } from "./publication-spec-path.ts";
import { resolvePublicationTitle } from "./spec-creation-title.ts";

export const NARRATIVE_START_MARKER = "<!-- jarvis:narrative:start -->";
export const NARRATIVE_END_MARKER = "<!-- jarvis:narrative:end -->";

type Git = (cwd: string, args: readonly string[]) => Promise<string>;
type FetchPrBody = (branch: string, cwd: string) => Promise<string>;
type WritePrBody = (branch: string, body: string, cwd: string) => Promise<void>;
type FetchPrTitle = (branch: string, cwd: string) => Promise<string>;
type WritePrTitle = (branch: string, title: string, cwd: string) => Promise<void>;

export type RefreshPrBodyInput = {
  specPath: string;
  branch: string;
  base: string;
  cwd: string;
  bodySummary?: string;
  narrative?: string;
  /** Raw (unformatted) spec path used to resolve the `index.md` heading for the title; falls back to `specPath`. */
  rawSpecPath?: string;
  /** Explicit title override, same precedence as `resolvePublicationTitle`'s `explicitTitle`. */
  creationTitle?: unknown;
  fetchPrBody?: FetchPrBody;
  writePrBody?: WritePrBody;
  fetchPrTitle?: FetchPrTitle;
  writePrTitle?: WritePrTitle;
  renderFooter?: (opts: { cwd: string; base: string; git?: Git }) => Promise<string>;
  git?: Git;
  /** Aborts the default `gh` fetch/write. */
  signal?: AbortSignal;
};

export function extractNarrative(prBody: string): string | null {
  const startIdx = prBody.indexOf(NARRATIVE_START_MARKER);
  if (startIdx === -1) {
    return null;
  }
  const afterStart = startIdx + NARRATIVE_START_MARKER.length;
  const endIdx = prBody.indexOf(NARRATIVE_END_MARKER, afterStart);
  if (endIdx === -1) {
    return null;
  }
  return prBody.slice(afterStart, endIdx).trim();
}

function buildSpecHeader(specPath: string, worktreePath: string): string {
  return `Spec: ${formatPublicationSpecPathForPrBody(worktreePath, specPath)}`;
}

function buildHeaderBlock(specPath: string, worktreePath: string, bodySummary?: string): string {
  const header = buildSpecHeader(specPath, worktreePath);
  const summary = bodySummary?.trim();
  return summary ? `${header}\n\n${summary}` : header;
}

function defaultFetchPrField(
  field: "body" | "title",
  branch: string,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  return realAsyncSubprocessRunner.runAsync(
    "gh",
    ["pr", "view", branch, "--json", field, "-q", `.${field}`],
    cwd,
    networkSubprocessOptions({ signal }),
  );
}

/** Default title-write seam: `gh pr edit <branch> --title <new>`. */
export function defaultWritePrTitle(
  branch: string,
  title: string,
  cwd: string,
  command = "gh",
  signal?: AbortSignal,
): Promise<void> {
  return realAsyncSubprocessRunner
    .runAsync(command, ["pr", "edit", branch, "--title", title], cwd, networkSubprocessOptions({ signal }))
    .then(() => {});
}

/** Kills a stdin-fed `gh pr edit` that outlives the network bound; rejects as a retryable timeout. */
export function defaultWritePrBody(
  branch: string,
  body: string,
  cwd: string,
  timeoutMs: number = NETWORK_SUBPROCESS_TIMEOUT_MS,
  command = "gh",
  signal?: AbortSignal,
): Promise<void> {
  const args = ["pr", "edit", branch, "--body-file", "-"];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: nonInteractiveNetworkEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      ...(signal !== undefined ? { signal } : {}),
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
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
      else if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `gh pr edit exited ${code ?? "unknown"}`));
    });
  });
}

/** Rewrite the ensured PR body: regenerated `Spec:` header, preserved narrative markers, attribution footer. */
export async function refreshPrBody(input: RefreshPrBodyInput): Promise<void> {
  const fetchPrBody = input.fetchPrBody ?? ((branch, cwd) => defaultFetchPrField("body", branch, cwd, input.signal));
  const writePrBody =
    input.writePrBody ??
    ((branch, body, cwd) => defaultWritePrBody(branch, body, cwd, NETWORK_SUBPROCESS_TIMEOUT_MS, "gh", input.signal));
  const renderFooter = input.renderFooter ?? renderAttribution;

  const currentBody = await fetchPrBody(input.branch, input.cwd);
  const extractedNarrative = extractNarrative(currentBody);
  const trimmedSuppliedNarrative = input.narrative?.trim() ?? "";
  const narrative = extractedNarrative ?? (trimmedSuppliedNarrative || null);
  const header = buildHeaderBlock(input.specPath, input.cwd, input.bodySummary);
  let headerAndNarrative = header;
  if (narrative !== null) {
    headerAndNarrative += `\n\n${NARRATIVE_START_MARKER}\n${narrative}\n${NARRATIVE_END_MARKER}`;
  }
  const footer = await renderFooter(
    input.git !== undefined
      ? { cwd: input.cwd, base: input.base, git: input.git }
      : { cwd: input.cwd, base: input.base },
  );
  const newBody = footer === "" ? headerAndNarrative : `${headerAndNarrative}\n\n---\n\n${footer}`;
  await writePrBody(input.branch, newBody, input.cwd);

  await refreshPrTitle(input);
}

/** Re-derives and, if changed, edits the PR title. Cosmetic: failures are logged, not thrown. */
async function refreshPrTitle(input: RefreshPrBodyInput): Promise<void> {
  const fetchPrTitle = input.fetchPrTitle ?? ((branch, cwd) => defaultFetchPrField("title", branch, cwd, input.signal));
  const writePrTitle =
    input.writePrTitle ?? ((branch, title, cwd) => defaultWritePrTitle(branch, title, cwd, "gh", input.signal));

  try {
    const resolvedTitle = resolvePublicationTitle(input.cwd, input.rawSpecPath ?? input.specPath, input.creationTitle);
    const currentTitle = await fetchPrTitle(input.branch, input.cwd);
    if (currentTitle !== resolvedTitle) {
      await writePrTitle(input.branch, resolvedTitle, input.cwd);
    }
  } catch (error) {
    console.error(`Failed to refresh PR title: ${errorMessage(error)}`);
  }
}
