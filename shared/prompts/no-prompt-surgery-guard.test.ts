import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

export const GUARDED_ASSEMBLY_PATHS = [
  "shared/prompts/plan-draft.ts",
  "shared/prompts/review-implement.ts",
  "v1/src/modes/plan/review.ts",
  "v1/src/modes/plan/verdict-actuator.ts",
  "v1/src/modes/patch/prompt.ts",
] as const;

export const FORBIDDEN_PROMPT_SURGERY_TOKENS = [
  "stripOptionalSection",
  "stripOptionalPromptSection",
  ".replace(",
  ".replaceAll(",
] as const;

export function findPromptSurgeryViolations(sourceByPath: Readonly<Record<string, string>>): string[] {
  const violations: string[] = [];
  for (const relPath of GUARDED_ASSEMBLY_PATHS) {
    const source = sourceByPath[relPath];
    if (source === undefined) {
      violations.push(`${relPath}: missing guarded assembly file`);
      continue;
    }
    for (const token of FORBIDDEN_PROMPT_SURGERY_TOKENS) {
      if (source.includes(token)) {
        violations.push(`${relPath}: forbidden prompt-surgery construct ${token}`);
      }
    }
  }
  return violations;
}

function readGuardedAssemblySources(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const relPath of GUARDED_ASSEMBLY_PATHS) {
    out[relPath] = readFileSync(join(REPO_ROOT, relPath), "utf-8");
  }
  return out;
}

test("prompt assembly builders omit post-render string surgery", () => {
  expect(findPromptSurgeryViolations(readGuardedAssemblySources())).toEqual([]);
});

test("prompt surgery guard fails when forbidden constructs appear in guarded assembly files", () => {
  const cleanSources = Object.fromEntries(GUARDED_ASSEMBLY_PATHS.map((relPath) => [relPath, ""]));
  const cases = [
    { token: "stripOptionalSection", source: "stripOptionalSection(rendered)" },
    { token: "stripOptionalPromptSection", source: "stripOptionalPromptSection(rendered)" },
    { token: ".replace(", source: 'rendered.replace("a", "b")' },
    { token: ".replaceAll(", source: 'rendered.replaceAll("a", "b")' },
  ] as const;

  for (const { token, source } of cases) {
    for (const relPath of GUARDED_ASSEMBLY_PATHS) {
      const violations = findPromptSurgeryViolations({ ...cleanSources, [relPath]: source });
      expect(violations).toEqual([`${relPath}: forbidden prompt-surgery construct ${token}`]);
    }
  }
});
