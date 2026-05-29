import { join } from "node:path";

export type {
  PromptArtifact,
  PromptMetadata,
  PromptPlaceholderDeclaration,
  PromptPlaceholderType,
  PromptRegistry,
} from "../../../src/shared/prompts/registry.ts";

import {
  createPromptRegistry as createSharedPromptRegistry,
  type PromptRegistry,
} from "../../../src/shared/prompts/registry.ts";

const V1_PROMPT_ARTIFACT_FILES = [
  join(import.meta.dir, "..", "..", "..", "prompts", "global", "terse.md"),
  join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "prompts",
    "global",
    "documentation.md",
  ),
  join(import.meta.dir, "..", "..", "..", "prompts", "global", "naming.md"),
  join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "prompts",
    "patch",
    "instructions.md",
  ),
  join(import.meta.dir, "..", "..", "..", "prompts", "patch", "rules.md"),
  join(import.meta.dir, "..", "..", "..", "prompts", "plan", "draft.md"),
  join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "prompts",
    "plan",
    "decisions-ledger.md",
  ),
  join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "prompts",
    "plan",
    "defer-to-consumer.md",
  ),
  join(import.meta.dir, "..", "..", "..", "prompts", "plan", "review.md"),
  join(import.meta.dir, "..", "..", "..", "prompts", "plan", "refine.md"),
] as const;

export function createPromptRegistry(
  sourcePaths: readonly string[] = V1_PROMPT_ARTIFACT_FILES,
): PromptRegistry {
  return createSharedPromptRegistry(sourcePaths);
}

let cachedRegistry: PromptRegistry | undefined;

export function loadPromptRegistry(): PromptRegistry {
  if (cachedRegistry === undefined) {
    cachedRegistry = createPromptRegistry();
  }
  return cachedRegistry;
}
