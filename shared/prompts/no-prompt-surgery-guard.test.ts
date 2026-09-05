import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findPromptSurgeryViolations,
  FORBIDDEN_PROMPT_SURGERY_TOKENS,
  PROMPT_SURGERY_GUARDED_ASSEMBLY_PATHS,
} from "./no-prompt-surgery-guard.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const FORBIDDEN_TOKEN_SAMPLE_SOURCES: Record<(typeof FORBIDDEN_PROMPT_SURGERY_TOKENS)[number], string> = {
  stripOptionalSection: "stripOptionalSection(rendered)",
  stripOptionalPromptSection: "stripOptionalPromptSection(rendered)",
  ".replace(": 'rendered.replace("a", "b")',
  ".replaceAll(": 'rendered.replaceAll("a", "b")',
};

test("prompt assembly builders omit post-render string surgery", () => {
  const sources: Record<string, string> = {};
  for (const relPath of PROMPT_SURGERY_GUARDED_ASSEMBLY_PATHS) {
    sources[relPath] = readFileSync(join(REPO_ROOT, relPath), "utf-8");
  }
  expect(findPromptSurgeryViolations(sources)).toEqual([]);
});

test("prompt surgery guard reports forbidden constructs", () => {
  const cleanSources = Object.fromEntries(PROMPT_SURGERY_GUARDED_ASSEMBLY_PATHS.map((relPath) => [relPath, ""]));
  const samplePath = PROMPT_SURGERY_GUARDED_ASSEMBLY_PATHS[0];
  if (samplePath === undefined) throw new Error("missing guarded assembly path");

  for (const token of FORBIDDEN_PROMPT_SURGERY_TOKENS) {
    const source = FORBIDDEN_TOKEN_SAMPLE_SOURCES[token];
    const violations = findPromptSurgeryViolations({ ...cleanSources, [samplePath]: source });
    expect(violations).toEqual([`${samplePath}: forbidden prompt-surgery construct ${token}`]);
  }
});
