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
};

export type ParsedSpec = {
  h1: string | undefined;
  tasks: TaskItem[];
  linkedSubspecs: LinkedSubspec[];
  acceptanceCriteria: AcceptanceCriterion[];
  blocker: string | undefined;
  warnings: string[];
};

const taskPattern = /^\s*-\s\[([ xX])\]\s+(.*)$/;
const h1Pattern = /^#\s+(.+)$/;
const headingPattern = /^(#{1,6})\s+(.+)$/;

/** Extract blocker body from content, returning undefined if empty or absent. */
function extractBlockerBody(content: string): { index: number; body: string | undefined } | undefined {
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

/** Collect warnings for near-miss headings. */
function collectHeadingWarnings(lines: string[]): string[] {
  const warnings: string[] = [];
  for (const line of lines) {
    if (line !== "## Acceptance criteria" && /^#{1,6}\s+acceptance criteria\s*$/i.test(line)) {
      warnings.push(
        `Rejected heading \`${line}\`: acceptance criteria header must be exactly \`## Acceptance criteria\` (case-sensitive, level-2).`,
      );
    }
    if (line !== "## Blocker" && /^#{1,6}\s+blocker\s*$/i.test(line)) {
      warnings.push(
        `Rejected heading \`${line}\`: blocker header must be exactly \`## Blocker\` (case-sensitive, level-2).`,
      );
    }
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

/** Parse acceptance criteria from section lines. */
function parseAcceptanceCriteria(sectionLines: string[]): AcceptanceCriterion[] {
  const acceptanceCriteria: AcceptanceCriterion[] = [];
  for (const line of sectionLines) {
    const taskMatch = line.match(taskPattern);
    if (!taskMatch?.[2]) {
      continue;
    }
    acceptanceCriteria.push({
      checked: (taskMatch[1] ?? " ").toLowerCase() === "x",
      text: taskMatch[2].trim(),
    });
  }
  return acceptanceCriteria;
}

export function parseSpec(content: string): ParsedSpec {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  const h1 = extractH1(content);
  const warnings = collectHeadingWarnings(lines);
  const { tasks, linkedSubspecs } = parseTasksAndSubspecs(lines);

  const acceptanceCriteriaSection = extractAcceptanceCriteriaSection(content);
  const acceptanceCriteria = acceptanceCriteriaSection ? parseAcceptanceCriteria(acceptanceCriteriaSection.lines) : [];

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
