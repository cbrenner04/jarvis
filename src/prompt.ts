import { readFileSync } from "node:fs";
import { join } from "node:path";

function readRule(name: string): string {
  return readFileSync(
    join(import.meta.dir, "..", "rules", name),
    "utf8",
  ).trim();
}

function jarvisRules(): string {
  return readRule("patch-mode.md");
}

export function buildPrompt(specPath: string): string {
  return [
    "Inspect the target repo for guidance, conventions, and relevant docs.",
    `Read the spec at ${specPath}.`,
    "Follow these Jarvis rules:",
    jarvisRules(),
    "Pick the single most important unchecked task and complete it.",
  ].join("\n");
}
