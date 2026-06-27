import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Io } from "../cli.ts";
import type { ConfigOptions } from "../config.ts";
import { findProjectMatchForPath } from "../config.ts";

const VALID_SECTIONS = ["Known gotchas", "Gate blind spots", "Cross-repo coordination"];

export type RunbookCommandOptions = {
  action: string;
  entry?: string;
  section?: string;
  issueUrl?: string;
  io: Io;
  config?: ConfigOptions;
  cwd?: string;
};

function renderEntry(entry: string, issueUrl?: string): string {
  if (issueUrl !== undefined) {
    return `- ${entry} ([jarvis issue](${issueUrl}))`;
  }
  return `- ${entry}`;
}

function findSectionIndex(content: string, sectionName: string): { startLine: number; endLine: number } | null {
  const lines: string[] = content.split("\n");
  let startLine = -1;

  // Find the section heading (case-insensitive)
  const escapedSectionName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRegex = new RegExp(`^## ${escapedSectionName}$`, "i");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && headingRegex.test(line)) {
      startLine = i;
      break;
    }
  }

  if (startLine === -1) {
    return null;
  }

  // Find the next heading or EOF
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line?.startsWith("## ")) {
      endLine = i;
      break;
    }
  }

  return { startLine, endLine };
}

function appendEntryToSection(content: string, sectionName: string, entry: string): string | null {
  const sectionInfo = findSectionIndex(content, sectionName);
  if (sectionInfo === null) {
    return null;
  }

  const lines: string[] = content.split("\n");
  const { startLine, endLine } = sectionInfo;

  // Find the last non-empty line in the section (before the next heading or EOF)
  let insertLine = startLine + 1;
  for (let i = endLine - 1; i > startLine; i -= 1) {
    const line = lines[i];
    if (line !== undefined && line.trim() !== "") {
      insertLine = i + 1;
      break;
    }
  }

  // Insert the new entry
  lines.splice(insertLine, 0, entry);
  return lines.join("\n");
}

export function runbookCommand(opts: RunbookCommandOptions): number {
  const { action, io } = opts;

  if (action === "" || action === undefined) {
    io.stderr(RUNBOOK_USAGE);
    return 1;
  }

  if (action !== "add") {
    io.stderr(RUNBOOK_USAGE);
    return 1;
  }

  // Validate entry text
  const entry = opts.entry?.trim() ?? "";
  if (entry === "") {
    io.stderr(RUNBOOK_USAGE);
    return 1;
  }

  // Validate section
  const section = opts.section ? opts.section.trim() : "Known gotchas";
  const normalizedSection = VALID_SECTIONS.find((s) => s.toLowerCase() === section.toLowerCase());
  if (normalizedSection === undefined) {
    io.stderr(
      `jarvis1: runbook add: unknown section ${JSON.stringify(section)}. Valid sections: ${VALID_SECTIONS.join(", ")}\n`,
    );
    return 1;
  }

  // Validate issue URL if provided
  if (opts.issueUrl !== undefined && opts.issueUrl.trim() === "") {
    io.stderr(RUNBOOK_USAGE);
    return 1;
  }

  // Find the project
  const cwd = opts.cwd ?? process.cwd();
  const project = findProjectMatchForPath(cwd, opts.config);
  if (project === undefined) {
    io.stderr(
      "jarvis1: runbook add: not inside any project registered with `jarvis1 init`. Run `jarvis1 init` in your project root.\n",
    );
    return 1;
  }

  // Read the runbook
  const runbookPath = resolve(project.root, "OPERATOR_RUNBOOK.md");
  let content: string;
  try {
    content = readFileSync(runbookPath, "utf8");
  } catch {
    io.stderr(
      `jarvis1: runbook add: OPERATOR_RUNBOOK.md not found at ${runbookPath}. Run \`jarvis1 init\` to create it.\n`,
    );
    return 1;
  }

  // Append the entry
  const renderedEntry = renderEntry(entry, opts.issueUrl?.trim());
  const targetSection: string = normalizedSection;
  const newContent = appendEntryToSection(content, targetSection, renderedEntry);
  if (newContent === null) {
    io.stderr(`jarvis1: runbook add: section ${JSON.stringify(targetSection)} not found in OPERATOR_RUNBOOK.md\n`);
    return 1;
  }

  // Write the runbook back
  try {
    writeFileSync(runbookPath, newContent, "utf8");
  } catch (err) {
    io.stderr(`jarvis1: runbook add: failed to write runbook: ${(err as Error).message}\n`);
    return 1;
  }

  return 0;
}

export const RUNBOOK_USAGE = `Usage: jarvis1 runbook add [--section <heading>] [--issue-url <url>] <entry>

  Append a learning to the project's OPERATOR_RUNBOOK.md.

  The entry text is required and must not be empty or whitespace-only.

Flags:
  --section <heading>     Target section heading (case-insensitive).
                          Valid sections: Known gotchas, Gate blind spots, Cross-repo coordination.
                          Default: Known gotchas.
  --issue-url <url>       Optional jarvis issue URL. If provided, formats the entry as
                          "- <entry> ([jarvis issue](<url>))".
`;
