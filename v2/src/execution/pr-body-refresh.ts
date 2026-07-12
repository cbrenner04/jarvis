import { execFile, spawn } from "node:child_process";
import { renderAttribution } from "./pr-attribution.ts";
import { normalizePublicationSpecPath } from "./publication-spec-path.ts";

export const NARRATIVE_START_MARKER = "<!-- jarvis:narrative:start -->";
export const NARRATIVE_END_MARKER = "<!-- jarvis:narrative:end -->";

type Git = (cwd: string, args: readonly string[]) => Promise<string>;
type FetchPrBody = (branch: string, cwd: string) => Promise<string>;
type WritePrBody = (branch: string, body: string, cwd: string) => Promise<void>;

export type RefreshPrBodyInput = {
  specPath: string;
  branch: string;
  base: string;
  cwd: string;
  fetchPrBody?: FetchPrBody;
  writePrBody?: WritePrBody;
  renderFooter?: (opts: { cwd: string; base: string; git?: Git }) => Promise<string>;
  git?: Git;
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
  return `Spec: ${normalizePublicationSpecPath(worktreePath, specPath)}`;
}

function defaultFetchPrBody(branch: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["pr", "view", branch, "--json", "body", "-q", ".body"],
      {
        cwd,
        env: process.env,
        encoding: "utf8",
      },
      (error: Error | null, stdout: string) => {
        if (error) reject(error);
        else resolve(stdout ?? "");
      },
    );
  });
}

function defaultWritePrBody(branch: string, body: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", ["pr", "edit", branch, "--body-file", "-"], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin?.write(body);
    child.stdin?.end();
    let stderr = "";
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `gh pr edit exited ${code ?? "unknown"}`));
    });
  });
}

/** Rewrite the ensured PR body: regenerated `Spec:` header, preserved narrative markers, attribution footer. */
export async function refreshPrBody(input: RefreshPrBodyInput): Promise<void> {
  const fetchPrBody = input.fetchPrBody ?? defaultFetchPrBody;
  const writePrBody = input.writePrBody ?? defaultWritePrBody;
  const renderFooter = input.renderFooter ?? renderAttribution;

  const currentBody = await fetchPrBody(input.branch, input.cwd);
  const narrative = extractNarrative(currentBody);
  const header = buildSpecHeader(input.specPath, input.cwd);
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
}
