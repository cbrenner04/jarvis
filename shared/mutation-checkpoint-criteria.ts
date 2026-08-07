import { parseSpec } from "./spec-parser.ts";

export const CRITERION_MARKER = "Mutation checkpoint:";
export const KEYSTONE_CRITERION_MARKER = "Keystone checkpoint:";
export const DIRECTIVE_PATTERN = /@mutate\s+(\S+)\s+"((?:[^"\\]|\\.)*)"\s*->\s*"((?:[^"\\]|\\.)*)"/;
const CANONICAL_GUARD_SUFFIX_PATTERN = /`([^`]+)`\s*—\s*`([^`]+)`;\s*Mutation checkpoint:/;
const PREFIX_FIRST_GUARD_PATTERN = /Mutation checkpoint:\s+in\s+`([^`]+)`\s+test\s+`([^`]+)`/;
const CANONICAL_KEYSTONE_SUFFIX_PATTERN = /`([^`]+)`\s*—\s*`([^`]+)`;\s*Keystone checkpoint:/;

const CHECKLIST_ITEM_PATTERN = /^\s*-\s\[([ xX])\]\s+(.*)$/;
const LEVEL_TWO_HEADING_PATTERN = /^##\s/;

/** Assembled `## Acceptance criteria` checklist blocks (first line text only, continuations included). */
export function acceptanceCriterionBlocks(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf("## Acceptance criteria");
  if (start === -1) return [];

  const blocks: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (LEVEL_TWO_HEADING_PATTERN.test(line)) break;
    const item = line.match(CHECKLIST_ITEM_PATTERN);
    if (item?.[2] === undefined) continue;

    let block = item[2].trim();
    for (i += 1; i < lines.length; i += 1) {
      const continuation = lines[i] ?? "";
      if (LEVEL_TWO_HEADING_PATTERN.test(continuation) || CHECKLIST_ITEM_PATTERN.test(continuation)) {
        i -= 1;
        break;
      }
      block += `\n${continuation.trim()}`;
    }
    blocks.push(block);
  }
  return blocks;
}

export type MutationCheckpointCriterion = {
  block: string;
  firstLine: string;
};

function isGuardMutationCheckpointBlock(block: string): boolean {
  if (DIRECTIVE_PATTERN.test(block)) return true;
  const canonical = CANONICAL_GUARD_SUFFIX_PATTERN.exec(block);
  if (canonical !== null && isTestFileReference(canonical[1] ?? "")) return true;
  const prefixFirst = PREFIX_FIRST_GUARD_PATTERN.exec(block);
  if (prefixFirst !== null && isTestFileReference(prefixFirst[1] ?? "")) return true;
  return false;
}

function isKeystoneCheckpointBlock(block: string): boolean {
  const match = CANONICAL_KEYSTONE_SUFFIX_PATTERN.exec(block);
  return match !== null && isTestFileReference(match[1] ?? "");
}

function selectCheckpointCriteria(
  content: string,
  kind: "guard" | "keystone",
  options: { requireChecked?: boolean } = {},
): MutationCheckpointCriterion[] {
  const requireChecked = options.requireChecked ?? false;
  const blocks = acceptanceCriterionBlocks(content);
  const selected: MutationCheckpointCriterion[] = [];
  for (const [index, criterion] of parseSpec(content).acceptanceCriteria.entries()) {
    if (criterion.humanOnly) continue;
    if (requireChecked && !criterion.checked) continue;
    const block = blocks[index] ?? criterion.text;
    const isKeystone = isKeystoneCheckpointBlock(block);
    if (kind === "keystone") {
      if (!isKeystone) continue;
    } else if (isKeystone || !isGuardMutationCheckpointBlock(block)) {
      continue;
    }
    selected.push({ block, firstLine: criterion.text });
  }
  return selected;
}

/** Mutation-checkpoint-shaped criteria from `## Acceptance criteria`, with full bullet blocks. */
export function selectMutationCheckpointCriteria(
  content: string,
  options: { requireChecked?: boolean } = {},
): MutationCheckpointCriterion[] {
  return selectCheckpointCriteria(content, "guard", options);
}

/** Keystone-checkpoint-shaped criteria from `## Acceptance criteria`, with full bullet blocks. */
export function selectKeystoneCheckpointCriteria(
  content: string,
  options: { requireChecked?: boolean } = {},
): MutationCheckpointCriterion[] {
  return selectCheckpointCriteria(content, "keystone", options);
}

function isTestFileReference(token: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/i.test(token) || token.includes(".test.");
}

/** True when criterion text backtick- or quote-names a plausible pin title beyond pinning file and directive. */
function criterionNamesPinTitle(block: string): boolean {
  const withoutDirectives = block
    .replace(/\/\/\s*@mutate[^\n]*/g, "")
    .replace(new RegExp(DIRECTIVE_PATTERN.source, "g"), "");
  const backtickTokens = [...withoutDirectives.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
  const quoteTokens = [...withoutDirectives.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1] ?? "");
  for (const token of [...backtickTokens, ...quoteTokens]) {
    if (isTestFileReference(token)) continue;
    if (token.trim().length > 0) return true;
  }
  return false;
}

export type AtRiskHollowPinFinding = {
  criterionText: string;
  rationale: string;
  sourceFile?: string;
};

const AT_RISK_HOLLOW_PINS_SECTION = "## At-risk hollow pins";
const HOLLOW_PIN_RATIONALE =
  "mutation-checkpoint criterion names no backticked or quoted pin title; implement-time linking may go hollow";

/** Advisory hollow-pin findings for mutation-checkpoint criteria missing a pin title reference. */
export function detectAtRiskHollowPinsInMarkdown(content: string, sourceFile?: string): AtRiskHollowPinFinding[] {
  const findings: AtRiskHollowPinFinding[] = [];
  for (const { block } of selectMutationCheckpointCriteria(content)) {
    if (!criterionNamesPinTitle(block)) {
      findings.push({
        criterionText: block,
        rationale: HOLLOW_PIN_RATIONALE,
        ...(sourceFile !== undefined ? { sourceFile } : {}),
      });
    }
  }
  return findings;
}

export function formatAtRiskHollowPinsSection(findings: readonly AtRiskHollowPinFinding[]): string {
  if (findings.length === 0) return "";
  const lines = [AT_RISK_HOLLOW_PINS_SECTION, ""];
  for (const finding of findings) {
    const prefix = finding.sourceFile === undefined ? "" : `[${finding.sourceFile}] `;
    lines.push(`- ${prefix}Criterion: ${finding.criterionText}`);
    lines.push(`  Rationale: ${finding.rationale}`);
  }
  return lines.join("\n");
}
