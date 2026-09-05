import { locateDiscoveredFile } from "../structural-test-locator.ts";

export const PROMPT_SURGERY_GUARDED_ASSEMBLY_PATHS = [
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
  for (const relPath of PROMPT_SURGERY_GUARDED_ASSEMBLY_PATHS) {
    const source = locateDiscoveredFile(sourceByPath, relPath);
    for (const token of FORBIDDEN_PROMPT_SURGERY_TOKENS) {
      if (source.includes(token)) {
        violations.push(`${relPath}: forbidden prompt-surgery construct ${token}`);
      }
    }
  }
  return violations;
}
