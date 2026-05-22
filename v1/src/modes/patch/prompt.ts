import { readFileSync } from "node:fs";
import { join } from "node:path";

function jarvisRules(): string {
  return readFileSync(join(import.meta.dir, "rules.md"), "utf8").trim();
}

export function buildPrompt(specPath: string, siblings?: string[]): string {
  const lines = [
    "Inspect the target repo for guidance, conventions, and relevant docs.",
    `Read the spec at ${specPath}.`,
  ];

  if (siblings !== undefined && siblings.length > 0) {
    lines.push(
      "Additional project sibling directories are available for this run:",
    );
    for (const sibling of siblings) {
      lines.push(`- ${sibling}`);
    }
    lines.push(
      "Treat these directories as part of the target project when the active spec requires cross-repo edits.",
    );
  }

  lines.push("Follow these Jarvis rules:", jarvisRules());
  lines.push("Pick the single most important unchecked task and complete it.");

  return lines.join("\n");
}
