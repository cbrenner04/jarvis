import { readFileSync } from "node:fs";
import { join } from "node:path";

function jarvisRules(): string {
  return readFileSync(
    join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "..",
      "prompts",
      "patch",
      "rules.md",
    ),
    "utf8",
  ).trim();
}

function baseInstructions(specPath: string): string[] {
  return readFileSync(
    join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "..",
      "prompts",
      "patch",
      "instructions.md",
    ),
    "utf8",
  )
    .split("\n")
    .map((line) => line.replace("{{SPEC_PATH}}", specPath));
}

export function buildPrompt(specPath: string, siblings?: string[]): string {
  const instructions = baseInstructions(specPath);
  const lines = instructions.slice(0, 2);

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

  lines.push(instructions[2] ?? "Follow these Jarvis rules:");
  lines.push(jarvisRules());
  lines.push(
    instructions[3] ??
      "Pick the single most important unchecked task and complete it.",
  );

  return lines.join("\n");
}
