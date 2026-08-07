import { acceptanceCriterionBlocks } from "./mutation-checkpoint-criteria.ts";
import { parseSpec } from "./spec-parser.ts";

export const UNFALSIFIABLE_PREMISES_SECTION = "## Unfalsifiable premises";

const REACHABILITY_PHRASES = [/\breachable on\b/i, /\bfails against the pre-fix\b/i, /\bconstructible on main\b/i];

const STRONG_PREMISE_PATTERNS = [
  /\bmay never\b/i,
  /\brules out\b/i,
  /\bcannot occur\b/i,
  /neither\b[^.\n]*\bmay equal\b/i,
];

const MUST_NOT_INVARIANT = /\bmust not\b[^.\n]*\b(equal|occur|be\b|match|coincide)\b/i;

/** True when criterion text asserts an invariant or rule-out guard premise. */
export function isPremiseBearingCriterion(block: string): boolean {
  if (STRONG_PREMISE_PATTERNS.some((pattern) => pattern.test(block))) return true;
  return /\bmust not\b/i.test(block) && MUST_NOT_INVARIANT.test(block);
}

function isTestFileReference(token: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/i.test(token) || token.includes(".test.");
}

function isProductionPath(token: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(token) && !isTestFileReference(token);
}

function hasReachabilityPhrase(block: string): boolean {
  return REACHABILITY_PHRASES.some((pattern) => pattern.test(block));
}

function testPathNamesFailureScenario(block: string, token: string): boolean {
  if (!isTestFileReference(token)) return false;
  const backtickTokens = [...block.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
  for (const candidate of backtickTokens) {
    if (candidate === token || isTestFileReference(candidate)) continue;
    if (candidate.trim().length > 0) return true;
  }
  const quoteTokens = [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1] ?? "");
  return quoteTokens.some((candidate) => candidate.trim().length > 0 && !isTestFileReference(candidate));
}

function productionPathHasViolationHook(block: string, token: string): boolean {
  if (!isProductionPath(token)) return false;
  const needle = `\`${token}\``;
  const idx = block.indexOf(needle);
  if (idx === -1) return false;
  const tail = block.slice(idx + needle.length);
  const sentenceEnd = tail.search(/[.;]\s/);
  const scope = sentenceEnd === -1 ? tail : tail.slice(0, sentenceEnd);
  if (/\bwhere\b/i.test(scope)) return true;
  return /`[^`]+`/.test(scope) && /\b(may|must not|cannot|never|equal|return)\b/i.test(scope);
}

/** True when staged criterion prose cites a reachable violation on the repository base. */
export function hasReachabilityCitation(block: string): boolean {
  if (hasReachabilityPhrase(block)) return true;
  const backtickTokens = [...block.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
  for (const token of backtickTokens) {
    if (testPathNamesFailureScenario(block, token)) return true;
    if (productionPathHasViolationHook(block, token)) return true;
  }
  return false;
}

export type UnfalsifiablePremiseFinding = {
  criterionText: string;
  rationale: string;
  sourceFile?: string;
};

const BASE_RATIONALE = "invariant or rule-out criterion cites no reachable violation on the repository base today";
const EMPTY_SUBSPEC_RATIONALE_SUFFIX =
  "; dropping it would leave the subspec with zero remaining non-human-only acceptance criteria";

/** Advisory premise findings for invariant criteria lacking a reachability citation. */
export function detectUnfalsifiablePremisesInMarkdown(
  content: string,
  sourceFile?: string,
): UnfalsifiablePremiseFinding[] {
  const blocks = acceptanceCriterionBlocks(content);
  const parsed = parseSpec(content);
  const nonHumanOnlyCount = parsed.acceptanceCriteria.filter((criterion) => !criterion.humanOnly).length;
  const findings: UnfalsifiablePremiseFinding[] = [];

  for (const [index, criterion] of parsed.acceptanceCriteria.entries()) {
    if (criterion.humanOnly) continue;
    const block = blocks[index] ?? criterion.text;
    if (!isPremiseBearingCriterion(block)) continue;
    if (hasReachabilityCitation(block)) continue;

    let rationale = BASE_RATIONALE;
    if (nonHumanOnlyCount === 1) {
      rationale += EMPTY_SUBSPEC_RATIONALE_SUFFIX;
    }

    findings.push({
      criterionText: block,
      rationale,
      ...(sourceFile !== undefined ? { sourceFile } : {}),
    });
  }

  return findings;
}

export function formatUnfalsifiablePremisesSection(findings: readonly UnfalsifiablePremiseFinding[]): string {
  if (findings.length === 0) return "";
  const lines = [UNFALSIFIABLE_PREMISES_SECTION, ""];
  for (const finding of findings) {
    const prefix = finding.sourceFile === undefined ? "" : `[${finding.sourceFile}] `;
    lines.push(`- ${prefix}Criterion: ${finding.criterionText}`);
    lines.push(`  Rationale: ${finding.rationale}`);
  }
  return lines.join("\n");
}
