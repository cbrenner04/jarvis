export type TaskItem = {
  checked: boolean;
  body: string;
};

export type LinkedSubspec = TaskItem & {
  text: string;
  path: string;
};

export type AcceptanceCriterion = {
  checked: boolean;
  text: string;
  humanOnly: boolean;
};

export type WarningKind =
  | "near-miss-acceptance-heading"
  | "near-miss-blocker-heading"
  | "duplicate-section"
  | "missing-anchor-behavioral-ac"
  | "unsatisfiable-acceptance-criterion";

export type ParsedSpecWarning = {
  kind: WarningKind;
  message: string;
};

export type ParsedSpec = {
  h1: string | undefined;
  tasks: TaskItem[];
  linkedSubspecs: LinkedSubspec[];
  acceptanceCriteria: AcceptanceCriterion[];
  blocker: string | undefined;
  warnings: ParsedSpecWarning[];
};

export const PATCH_TIERS = ["trivial", "standard", "hard"] as const;

export type PatchTier = (typeof PATCH_TIERS)[number];

const taskPattern = /^\s*-\s\[([ xX])\]\s+(.*)$/;
const h1Pattern = /^#\s+(.+)$/;
const headingPattern = /^(#{1,6})\s+(.+)$/;

function isPatchTier(value: string): value is PatchTier {
  return (PATCH_TIERS as readonly string[]).includes(value);
}

function patchTierGuidance(): string {
  return `accepted values: ${PATCH_TIERS.join(", ")}`;
}

export function parseRunnableIndexTier(content: string): { tier: PatchTier | undefined; error: string | undefined } {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;
  let sawChecklist = false;
  let tier: PatchTier | undefined;
  let tierLineNumber: number | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    if (taskPattern.test(line)) {
      sawChecklist = true;
    }

    const match = line.match(/^tier:\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }

    const lineNumber = i + 1;
    if (sawChecklist) {
      return {
        tier: undefined,
        error: `invalid \`tier:\` metadata on line ${lineNumber}: \`tier:\` must appear before the first checklist item; ${patchTierGuidance()}`,
      };
    }

    if (tierLineNumber !== undefined) {
      return {
        tier: undefined,
        error: `invalid \`tier:\` metadata on line ${lineNumber}: duplicate \`tier:\` line (first seen on line ${tierLineNumber}); ${patchTierGuidance()}`,
      };
    }

    const value = match[1] ?? "";
    if (!isPatchTier(value)) {
      return {
        tier: undefined,
        error: `invalid \`tier:\` metadata on line ${lineNumber}: expected one of ${PATCH_TIERS.join(", ")}`,
      };
    }

    tier = value;
    tierLineNumber = lineNumber;
  }

  return { tier, error: undefined };
}

/** Extract blocker body from content, returning undefined if empty or absent. */
export function extractBlockerBody(content: string): { index: number; body: string | undefined } | undefined {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  let exactBlockerHeaderIndex: number | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    if (line === "## Blocker") {
      exactBlockerHeaderIndex = i;
      break; // Take first occurrence
    }
  }

  if (exactBlockerHeaderIndex === undefined) {
    return undefined;
  }

  // Extract the blocker body
  const bodyLines: string[] = [];
  for (let i = exactBlockerHeaderIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const headingMatch = line.match(headingPattern);
    if (headingMatch?.[1] === "##") {
      // Stop at the next level-2 heading
      break;
    }
    bodyLines.push(line);
  }

  const body = bodyLines.join("\n").trim();
  return {
    index: exactBlockerHeaderIndex,
    body: body.length > 0 ? body : undefined,
  };
}

function readFrontmatter(text: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return null;
  }
  return normalized.slice(0, end + 5);
}

/** True when `after` is `before` plus a newly appended non-empty `## Blocker` section. */
export function hasGenuineBlocker(before: string, after: string): boolean {
  const blocker = extractBlockerBody(after);

  if (blocker === undefined || blocker.body === undefined) {
    return false;
  }

  if (readFrontmatter(before) !== readFrontmatter(after)) {
    return false;
  }

  const afterLines = after.replace(/\r\n/g, "\n").split("\n");
  const beforeBlocker = afterLines.slice(0, blocker.index).join("\n").trim();

  return beforeBlocker === before.trim();
}

/** Extract h1 heading from content. */
function extractH1(content: string): string | undefined {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const h1Match = line.match(h1Pattern);
    if (h1Match?.[1]) {
      return h1Match[1].trim();
    }
  }
  return undefined;
}

/** Extract acceptance criteria section from content, returning undefined if absent. */
function extractAcceptanceCriteriaSection(content: string): { index: number; lines: string[] } | undefined {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  let exactAcceptanceHeaderIndex: number | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    if (line === "## Acceptance criteria") {
      exactAcceptanceHeaderIndex = i;
      break; // Take first occurrence
    }
  }

  if (exactAcceptanceHeaderIndex === undefined) {
    return undefined;
  }

  const sectionLines: string[] = [];
  for (let i = exactAcceptanceHeaderIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const headingMatch = line.match(headingPattern);
    if (headingMatch?.[1] === "##") {
      break;
    }
    sectionLines.push(line);
  }

  return { index: exactAcceptanceHeaderIndex, lines: sectionLines };
}

/** Collect warnings for near-miss headings and duplicate sections. */
function collectHeadingWarnings(lines: string[]): ParsedSpecWarning[] {
  const warnings: ParsedSpecWarning[] = [];
  let acceptanceCriteriaCount = 0;
  let blockerCount = 0;

  for (const line of lines) {
    if (line === "## Acceptance criteria") {
      acceptanceCriteriaCount += 1;
    } else if (line !== "## Acceptance criteria" && /^#{1,6}\s+acceptance criteria\s*$/i.test(line)) {
      warnings.push({
        kind: "near-miss-acceptance-heading",
        message: `Rejected heading \`${line}\`: acceptance criteria header must be exactly \`## Acceptance criteria\` (case-sensitive, level-2).`,
      });
    }

    if (line === "## Blocker") {
      blockerCount += 1;
    } else if (line !== "## Blocker" && /^#{1,6}\s+blocker\s*$/i.test(line)) {
      warnings.push({
        kind: "near-miss-blocker-heading",
        message: `Rejected heading \`${line}\`: blocker header must be exactly \`## Blocker\` (case-sensitive, level-2).`,
      });
    }
  }

  if (acceptanceCriteriaCount > 1) {
    warnings.push({
      kind: "duplicate-section",
      message: `Duplicate section: \`## Acceptance criteria\` appears ${acceptanceCriteriaCount} times.`,
    });
  }

  if (blockerCount > 1) {
    warnings.push({
      kind: "duplicate-section",
      message: `Duplicate section: \`## Blocker\` appears ${blockerCount} times.`,
    });
  }

  return warnings;
}

/** Parse tasks and linked subspecs from lines. */
function parseTasksAndSubspecs(lines: string[]): {
  tasks: TaskItem[];
  linkedSubspecs: LinkedSubspec[];
} {
  const tasks: TaskItem[] = [];
  const linkedSubspecs: LinkedSubspec[] = [];

  for (const line of lines) {
    const taskMatch = line.match(taskPattern);
    if (!taskMatch?.[2]) {
      continue;
    }

    const checked = (taskMatch[1] ?? " ").toLowerCase() === "x";
    const body = taskMatch[2].trim();
    tasks.push({ checked, body });

    const linkMatch = body.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch?.[1] && linkMatch[2]) {
      linkedSubspecs.push({
        checked,
        body,
        text: linkMatch[1],
        path: linkMatch[2],
      });
    }
  }

  return { tasks, linkedSubspecs };
}

/** Detect if a criterion text is human-only based on trailing markers.
 * Markers (case-insensitive, trailing-anchored): (Manual), "visual inspection only", "no automated guard"
 */
export function isHumanOnlyCriterion(text: string): boolean {
  const trimmed = text.trim();
  let testText = trimmed;
  if (testText.endsWith(".")) {
    testText = testText.slice(0, -1).trim();
  }
  const markers = ["(manual)", "visual inspection only", "no automated guard"];
  return markers.some((marker) => testText.toLowerCase().endsWith(marker));
}

/** Parse acceptance criteria from section lines. */
function parseAcceptanceCriteria(sectionLines: string[]): AcceptanceCriterion[] {
  const acceptanceCriteria: AcceptanceCriterion[] = [];
  for (const line of sectionLines) {
    const taskMatch = line.match(taskPattern);
    if (!taskMatch?.[2]) {
      continue;
    }
    const text = taskMatch[2].trim();
    acceptanceCriteria.push({
      checked: (taskMatch[1] ?? " ").toLowerCase() === "x",
      text,
      humanOnly: isHumanOnlyCriterion(text),
    });
  }
  return acceptanceCriteria;
}

/** Detect if an acceptance criterion is a behavioral/preservation AC.
 * Trigger verbs (case-insensitive, whole-word): preserved, unchanged, stays, remains, stops, continues.
 */
export function isBehavioralPreservationAc(criterion: AcceptanceCriterion): boolean {
  const text = criterion.text.toLowerCase();
  const triggerVerbs = [/\bpreserved\b/, /\bunchanged\b/, /\bstays\b/, /\bremains\b/, /\bstops\b/, /\bcontinues\b/];
  return triggerVerbs.some((verb) => verb.test(text));
}

/** Check if an acceptance criterion text contains a path-like anchor.
 * An anchor is a *.test.ts filename/path, or a backtick span containing a path separator or source-file extension.
 */
export function hasPathLikeAnchor(criterion: AcceptanceCriterion): boolean {
  const text = criterion.text;

  // Check for *.test.ts filename/path patterns (e.g., "plan-draft-hard-error-continue.test.ts")
  if (/\b\w+.*\.test\.ts\b/.test(text)) {
    return true;
  }

  // Check for backtick spans containing path separators or source-file extensions
  const backtickPattern = /`([^`]+)`/g;
  for (const match of text.matchAll(backtickPattern)) {
    const content = match[1] ?? "";
    // Path-like if it contains a path separator or a source-file extension
    if (content.includes("/") || /\.\w+$/.test(content)) {
      return true;
    }
  }

  return false;
}

export function parseSpec(content: string): ParsedSpec {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  const h1 = extractH1(content);
  const warnings = collectHeadingWarnings(lines);
  const { tasks, linkedSubspecs } = parseTasksAndSubspecs(lines);

  const acceptanceCriteriaSection = extractAcceptanceCriteriaSection(content);
  const acceptanceCriteria = acceptanceCriteriaSection ? parseAcceptanceCriteria(acceptanceCriteriaSection.lines) : [];

  // Check for behavioral/preservation ACs without anchors
  for (const criterion of acceptanceCriteria) {
    if (isBehavioralPreservationAc(criterion) && !hasPathLikeAnchor(criterion)) {
      warnings.push({
        kind: "missing-anchor-behavioral-ac",
        message: `Behavioral/preservation AC lacks test or source anchor: "${criterion.text}". Cite an existing test (e.g., \`plan-draft-hard-error-continue.test.ts\`) or source path (e.g., \`v1/src/commands/plan.ts\`).`,
      });
    }
  }

  // Check for unsatisfiable ACs (non-human-only asserting GitHub/network-only facts)
  for (const criterion of acceptanceCriteria) {
    if (isUnsatisfiableAc(criterion)) {
      warnings.push({
        kind: "unsatisfiable-acceptance-criterion",
        message: `Unsatisfiable AC (cannot be verified from implement worktree without network/GitHub): "${criterion.text}". Mark as human-only with (Manual), "visual inspection only", or "no automated guard" if this is post-merge verification.`,
      });
    }
  }

  const blockerExtraction = extractBlockerBody(content);
  const blocker = blockerExtraction?.body;

  return {
    h1,
    tasks,
    linkedSubspecs,
    acceptanceCriteria,
    blocker,
    warnings,
  };
}

/**
 * Detect if a file contains a ## Blocker section (case-sensitive, level-2).
 * Returns both whether a blocker exists and its body text (if any).
 * Emits no warnings; near-miss headings are ignored.
 */
export function detectBlocker(content: string): {
  hasBlocker: boolean;
  body?: string | undefined;
} {
  const blockerExtraction = extractBlockerBody(content);

  if (blockerExtraction === undefined) {
    return { hasBlocker: false };
  }

  return {
    hasBlocker: true,
    body: blockerExtraction.body,
  };
}

/**
 * Detect if a blocker body contains pre-existing-failure language
 * (e.g., "pre-existing", "preexisting", "unrelated", "baseline", "already fail", etc.).
 * Match is case-insensitive and errs toward matching.
 */
export function detectBlockerClaim(body: string): boolean {
  const normalizedBody = body.toLowerCase();
  const claimPatterns = [
    /pre-?existing/,
    /unrelated/,
    /baseline/,
    /already fail/,
    /not caused by/,
    /not related to/,
    /not my change/,
    /pre-existing/,
    /preexisting/,
  ];

  return claimPatterns.some((pattern) => pattern.test(normalizedBody));
}

/**
 * Strip the ## Blocker section from spec content.
 * Removes exactly the ## Blocker heading through the next ## heading (or EOF),
 * leaving other sections intact. Returns the modified content.
 */
export function stripBlockerSection(content: string): string {
  const blockerExtraction = extractBlockerBody(content);
  if (blockerExtraction === undefined) {
    // No blocker section found, return content unchanged
    return content;
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blockerHeaderIndex = blockerExtraction.index;

  // Find the end of the blocker section (next ## heading or EOF)
  let blockerEndIndex = lines.length;
  for (let i = blockerHeaderIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const headingMatch = line.match(headingPattern);
    if (headingMatch?.[1] === "##") {
      blockerEndIndex = i;
      break;
    }
  }

  // Remove lines from blocker header through the end of the section
  const resultLines = [...lines.slice(0, blockerHeaderIndex), ...lines.slice(blockerEndIndex)];

  // Remove trailing blank lines at the end if present
  while (resultLines.length > 0 && (resultLines[resultLines.length - 1] ?? "").trim() === "") {
    resultLines.pop();
  }

  return resultLines.join("\n");
}

/**
 * Detect if an acceptance criterion asserts something only verifiable via
 * GitHub/network resources (PR body/title, CI status, review state, etc.).
 * These are non-automatable from the implement worktree and must be marked
 * human-only to be valid. Returns true if unsatisfiable (not human-only AND
 * asserts GitHub/network-only facts).
 */
export function isUnsatisfiableAc(criterion: AcceptanceCriterion): boolean {
  // Human-only criteria are exempt
  if (criterion.humanOnly) {
    return false;
  }

  const text = criterion.text.toLowerCase();

  // Patterns for GitHub/network-only assertions
  const unsatisfiablePatterns = [
    // PR body/title
    /\bpr\s+(body|title|lists|describes|states|includes)/,
    /\bpull request\s+(body|title)/,

    // CI status/checks
    /\b(ci|github\s+actions?|checks?|status)\s+(is\s+)?green/,
    /\b(ci|checks?|status)\s+(pass(es)?|succeeds?|is\s+passing|are\s+passing)/,
    /\bgreen\s+ci\b/,
    /\bci\s+validates?\b/,
    /\bgithub\s+actions?\s+(succeeds?|passes?|workflow)/,
    /\b(workflow|build)\s+.*(passes?|succeeds?)/,

    // Review state
    /\breview(s|ed)?\s+(is\s+)?(ready|approved|passed|complete)/,
    /\bpr\s+(is\s+)?(ready|approved|reviewed)/,
    /\breview\s+(passes?|gate)/,
    /\b(ready\s+)?gate\s+(passes?|fails?)/,
    /\bready\b.*\bgate\b/,

    // Merge status
    /\b(is\s+)?merged?/,
    /\bmerges?\s+to\s+(main|master)/,

    // Approval/merge-ability
    /\bapproved\b/,
    /\bapprovable\b/,
    /\bapproval\s+(is\s+required|passes?)/,

    // Comments/reactions
    /\bcomments?(\s+on)?\s+(pr|pull request)/,
    /\b(reactions?|emoji|👍|✓)\s+on\s+(pr|pull request)/,
  ];

  return unsatisfiablePatterns.some((pattern) => pattern.test(text));
}

/**
 * Classify if an acceptance criterion is "structural" — a location/containment/existence
 * claim about code structure with no observable runtime/operator outcome clause.
 * Location/existence verbs: "lives in", "is defined in", "exists as", "has unit tests".
 */
export function isStructuralAc(criterion: AcceptanceCriterion): boolean {
  const text = criterion.text.toLowerCase();

  // Location/existence verbs: key patterns
  const locationVerbs = [
    /\blives in\b/,
    /\bis defined in\b/,
    /\bexists as\b/,
    /\bhas unit tests?\b/,
    /\bincludes\b.*test/,
    /\bincludedst\b.*test/,
  ];

  const hasLocationVerb = locationVerbs.some((verb) => verb.test(text));
  if (!hasLocationVerb) {
    return false;
  }

  // Check for behavioral assertion patterns (e.g. "returns", "produces", "causes", "enables")
  // These indicate the AC names a symbol as the subject of a behavioral claim, not just location.
  const behavioralVerbs = [/\breturns\b/, /\bproduces\b/, /\bcauses\b/, /\benables\b/, /\bfails\b/, /\braises\b/];

  const hasBehavioralVerb = behavioralVerbs.some((verb) => verb.test(text));
  if (hasBehavioralVerb) {
    return false;
  }

  return true;
}
