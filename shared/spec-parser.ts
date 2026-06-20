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
function extractBlockerBody(
  content: string,
): { index: number; body: string | undefined } | undefined {
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

/** Extract acceptance criteria section from content, returning undefined if absent. */
function extractAcceptanceCriteriaSection(
  content: string,
): { index: number; lines: string[] } | undefined {
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

export function parseSpec(content: string): ParsedSpec {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  const tasks: TaskItem[] = [];
  const linkedSubspecs: LinkedSubspec[] = [];
  const acceptanceCriteria: AcceptanceCriterion[] = [];
  const warnings: string[] = [];

  let h1: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    if (h1 === undefined) {
      const h1Match = line.match(h1Pattern);
      if (h1Match?.[1]) {
        h1 = h1Match[1].trim();
      }
    }

    const taskMatch = line.match(taskPattern);
    if (taskMatch?.[2]) {
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

    // Warn on near-miss acceptance criteria headings
    if (line !== "## Acceptance criteria" && /^#{1,6}\s+acceptance criteria\s*$/i.test(line)) {
      warnings.push(
        `Rejected heading \`${line}\`: acceptance criteria header must be exactly \`## Acceptance criteria\` (case-sensitive, level-2).`,
      );
    }

    // Warn on near-miss blocker headings
    if (line !== "## Blocker" && /^#{1,6}\s+blocker\s*$/i.test(line)) {
      warnings.push(
        `Rejected heading \`${line}\`: blocker header must be exactly \`## Blocker\` (case-sensitive, level-2).`,
      );
    }
  }

  // Extract acceptance criteria from the section
  const acceptanceCriteriaSection = extractAcceptanceCriteriaSection(content);
  if (acceptanceCriteriaSection) {
    for (const line of acceptanceCriteriaSection.lines) {
      const taskMatch = line.match(taskPattern);
      if (!taskMatch?.[2]) {
        continue;
      }
      acceptanceCriteria.push({
        checked: (taskMatch[1] ?? " ").toLowerCase() === "x",
        text: taskMatch[2].trim(),
      });
    }
  }

  // Extract blocker
  let blocker: string | undefined;
  const blockerExtraction = extractBlockerBody(content);
  if (blockerExtraction?.body !== undefined) {
    blocker = blockerExtraction.body;
  }

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
