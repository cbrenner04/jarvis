import { execFileSync } from "node:child_process";
import { renderAttribution } from "./pr-attribution.ts";

export const NARRATIVE_START_MARKER = "<!-- jarvis:narrative:start -->";
export const NARRATIVE_END_MARKER = "<!-- jarvis:narrative:end -->";

type Git = (cwd: string, args: readonly string[]) => string;

export type RefreshPrBodyInput = {
  specPath: string;
  branch: string;
  base: string;
  cwd: string;
  fetchPrBody?: (branch: string, cwd: string) => string;
  writePrBody?: (branch: string, body: string, cwd: string) => void;
  renderFooter?: (opts: { cwd: string; base: string; git?: Git }) => string;
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

function buildSpecHeader(specPath: string): string {
  return `Spec: ${specPath}`;
}

function defaultFetchPrBody(branch: string, cwd: string): string {
  return execFileSync("gh", ["pr", "view", branch, "--json", "body", "-q", ".body"], {
    cwd,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
}

function defaultWritePrBody(branch: string, body: string, cwd: string): void {
  execFileSync("gh", ["pr", "edit", branch, "--body-file", "-"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: body,
  });
}

/** Rewrite the ensured PR body: regenerated `Spec:` header, preserved narrative markers, attribution footer. */
export function refreshPrBody(input: RefreshPrBodyInput): void {
  const fetchPrBody = input.fetchPrBody ?? defaultFetchPrBody;
  const writePrBody = input.writePrBody ?? defaultWritePrBody;
  const renderFooter = input.renderFooter ?? renderAttribution;

  const currentBody = fetchPrBody(input.branch, input.cwd);
  const narrative = extractNarrative(currentBody);
  const header = buildSpecHeader(input.specPath);
  let headerAndNarrative = header;
  if (narrative !== null) {
    headerAndNarrative += `\n\n${NARRATIVE_START_MARKER}\n${narrative}\n${NARRATIVE_END_MARKER}`;
  }
  const footer = renderFooter(
    input.git !== undefined
      ? { cwd: input.cwd, base: input.base, git: input.git }
      : { cwd: input.cwd, base: input.base },
  );
  const newBody = footer === "" ? headerAndNarrative : `${headerAndNarrative}\n\n---\n\n${footer}`;
  writePrBody(input.branch, newBody, input.cwd);
}
