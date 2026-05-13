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

export function parsePatchSpec(content: string): ParsedSpec {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  const tasks: TaskItem[] = [];
  const linkedSubspecs: LinkedSubspec[] = [];
  const acceptanceCriteria: AcceptanceCriterion[] = [];
  const warnings: string[] = [];

  let h1: string | undefined;
  let exactAcceptanceHeaderIndex: number | undefined;
  let exactBlockerHeaderIndex: number | undefined;

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

    if (line === "## Acceptance criteria") {
      exactAcceptanceHeaderIndex = i;
    } else if (/^#{1,6}\s+acceptance criteria\s*$/i.test(line)) {
      warnings.push(
        `Rejected heading \`${line}\`: acceptance criteria header must be exactly \`## Acceptance criteria\` (case-sensitive, level-2).`,
      );
    }

    if (line === "## Blocker") {
      exactBlockerHeaderIndex = i;
    } else if (/^#{1,6}\s+blocker\s*$/i.test(line)) {
      warnings.push(
        `Rejected heading \`${line}\`: blocker header must be exactly \`## Blocker\` (case-sensitive, level-2).`,
      );
    }
  }

  if (exactAcceptanceHeaderIndex !== undefined) {
    for (let i = exactAcceptanceHeaderIndex + 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const headingMatch = line.match(headingPattern);
      if (headingMatch?.[1] === "##") {
        break;
      }
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

  let blocker: string | undefined;
  if (exactBlockerHeaderIndex !== undefined) {
    const bodyLines: string[] = [];
    for (let i = exactBlockerHeaderIndex + 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const headingMatch = line.match(headingPattern);
      if (headingMatch?.[1] === "##") {
        break;
      }
      bodyLines.push(line);
    }
    const body = bodyLines.join("\n").trim();
    if (body.length > 0) {
      blocker = body;
    }
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
