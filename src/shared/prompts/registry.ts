import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PromptMetadata = {
  id: string;
  behavior: string;
  kind: string;
  revision: string;
  fragmentOf: string[];
  overrides: string[];
  placeholders: PromptPlaceholderDeclaration[];
};

export type PromptPlaceholderType = "string";

export type PromptPlaceholderDeclaration = {
  name: string;
  type: PromptPlaceholderType;
  required: boolean;
};

export type PromptArtifact = {
  metadata: PromptMetadata;
  sourcePath: string;
  body: string;
};

const PROMPTS_ROOT = join(import.meta.dir, "..", "..", "..", "prompts");

export const DEFAULT_SHARED_PROMPT_ARTIFACT_FILES = [
  join(PROMPTS_ROOT, "global", "terse.md"),
  join(PROMPTS_ROOT, "global", "documentation.md"),
  join(PROMPTS_ROOT, "global", "naming.md"),
  join(PROMPTS_ROOT, "patch", "instructions.md"),
  join(PROMPTS_ROOT, "patch", "rules.md"),
  join(PROMPTS_ROOT, "plan", "draft.md"),
  join(PROMPTS_ROOT, "plan", "decisions-ledger.md"),
  join(PROMPTS_ROOT, "plan", "defer-to-consumer.md"),
  join(PROMPTS_ROOT, "plan", "review.md"),
  join(PROMPTS_ROOT, "plan", "refine.md"),
  join(PROMPTS_ROOT, "write", "execute.md"),
] as const;

const REQUIRED_METADATA_FIELDS = [
  "id",
  "behavior",
  "kind",
  "revision",
] as const;

function parseListValue(value: string): string[] {
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner
      .split(",")
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
      .filter((part) => part.length > 0);
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parsePlaceholdersValue(value: string): PromptPlaceholderDeclaration[] {
  const entries = parseListValue(value);
  return entries.map((entry) => {
    const match = /^([A-Z_][A-Z_0-9]*):(string)(!)?$/.exec(entry);
    if (match === null) {
      throw new Error(
        `invalid placeholder declaration \`${entry}\`; expected NAME:string or NAME:string!`,
      );
    }
    const name = match[1];
    const type = match[2];
    if (name === undefined || type === undefined) {
      throw new Error(`invalid placeholder declaration \`${entry}\``);
    }
    const required = match[3] === "!";
    return { name, type: type as PromptPlaceholderType, required };
  });
}

function parseFrontmatter(text: string): {
  fields: Map<string, string>;
  body: string;
} {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("missing leading frontmatter block");
  }

  const endMarker = "\n---\n";
  const endIndex = normalized.indexOf(endMarker, 4);
  if (endIndex === -1) {
    throw new Error("unterminated frontmatter block");
  }

  const frontmatterText = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + endMarker.length);
  const fields = new Map<string, string>();

  for (const line of frontmatterText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    fields.set(key, value);
  }

  return { fields, body };
}

function readPromptArtifact(sourcePath: string): PromptArtifact {
  const raw = readFileSync(sourcePath, "utf8");
  const { fields, body } = parseFrontmatter(raw);

  for (const field of REQUIRED_METADATA_FIELDS) {
    const value = fields.get(field);
    if (value === undefined || value.length === 0) {
      throw new Error(
        `missing required metadata \`${field}\` in prompt artifact ${sourcePath}`,
      );
    }
  }

  const id = fields.get("id");
  const behavior = fields.get("behavior");
  const kind = fields.get("kind");
  const revision = fields.get("revision");
  if (
    id === undefined ||
    behavior === undefined ||
    kind === undefined ||
    revision === undefined
  ) {
    throw new Error(`invalid metadata state in prompt artifact ${sourcePath}`);
  }

  const fragmentOf = parseListValue(fields.get("fragmentOf") ?? "");
  const overrides = parseListValue(fields.get("overrides") ?? "");
  const placeholders = parsePlaceholdersValue(fields.get("placeholders") ?? "");

  return {
    metadata: {
      id,
      behavior,
      kind,
      revision,
      fragmentOf,
      overrides,
      placeholders,
    },
    sourcePath,
    body,
  };
}

export type PromptRegistry = {
  getById(id: string): PromptArtifact;
  all(): ReadonlyArray<PromptArtifact>;
};

export function createPromptRegistry(
  sourcePaths: readonly string[] = DEFAULT_SHARED_PROMPT_ARTIFACT_FILES,
): PromptRegistry {
  const artifacts = sourcePaths.map((path) => readPromptArtifact(path));
  const byId = new Map<string, PromptArtifact>();

  for (const artifact of artifacts) {
    const existing = byId.get(artifact.metadata.id);
    if (existing !== undefined) {
      throw new Error(
        `duplicate prompt id \`${artifact.metadata.id}\` in ${existing.sourcePath} and ${artifact.sourcePath}`,
      );
    }
    byId.set(artifact.metadata.id, artifact);
  }

  for (const artifact of artifacts) {
    for (const parentId of artifact.metadata.fragmentOf) {
      if (!byId.has(parentId)) {
        throw new Error(
          `unknown fragment membership reference \`${parentId}\` in prompt artifact ${artifact.sourcePath}`,
        );
      }
    }
    for (const targetId of artifact.metadata.overrides) {
      if (!byId.has(targetId)) {
        throw new Error(
          `unknown explicit override target \`${targetId}\` in prompt artifact ${artifact.sourcePath}`,
        );
      }
    }
  }

  return {
    getById(id: string): PromptArtifact {
      const artifact = byId.get(id);
      if (artifact === undefined) {
        throw new Error(`unknown prompt id \`${id}\``);
      }
      return artifact;
    },
    all(): ReadonlyArray<PromptArtifact> {
      return artifacts;
    },
  };
}

let cachedRegistry: PromptRegistry | undefined;

export function loadPromptRegistry(): PromptRegistry {
  if (cachedRegistry === undefined) {
    cachedRegistry = createPromptRegistry();
  }
  return cachedRegistry;
}
