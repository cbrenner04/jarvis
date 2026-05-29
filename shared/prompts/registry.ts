import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PromptArtifact,
  PromptPlaceholderDeclaration,
  PromptPlaceholderType,
  PromptRegistry,
} from "./types.ts";

const PROMPTS_DIR = join(import.meta.dir, "..", "..", "prompts");

/**
 * Discover every registry artifact under `prompts/`, sorted for deterministic
 * load order. An artifact is a `.md` file with a leading frontmatter block;
 * frontmatter-less templates (loaded directly by other call sites) are skipped.
 */
function discoverPromptArtifactFiles(dir: string = PROMPTS_DIR): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => join(dir, entry))
    .filter((path) => readFileSync(path, "utf8").startsWith("---\n"))
    .sort();
}

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

function requireField(
  fields: Map<string, string>,
  field: string,
  sourcePath: string,
): string {
  const value = fields.get(field);
  if (value === undefined || value.length === 0) {
    throw new Error(
      `missing required metadata \`${field}\` in prompt artifact ${sourcePath}`,
    );
  }
  return value;
}

function parseOrderValue(
  value: string | undefined,
  sourcePath: string,
): number | null {
  if (value === undefined || value.length === 0) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(
      `invalid order \`${value}\` in prompt artifact ${sourcePath}; expected an integer`,
    );
  }
  return parsed;
}

function readPromptArtifact(sourcePath: string): PromptArtifact {
  const raw = readFileSync(sourcePath, "utf8");
  const { fields, body } = parseFrontmatter(raw);

  const id = requireField(fields, "id", sourcePath);
  const behavior = requireField(fields, "behavior", sourcePath);
  const kind = requireField(fields, "kind", sourcePath);
  const revision = requireField(fields, "revision", sourcePath);
  if (kind !== "step" && kind !== "fragment") {
    throw new Error(
      `invalid kind \`${kind}\` in prompt artifact ${sourcePath}; expected step|fragment`,
    );
  }

  return {
    metadata: {
      id,
      behavior,
      kind,
      revision,
      order: parseOrderValue(fields.get("order"), sourcePath),
      fragmentOf: parseListValue(fields.get("fragmentOf") ?? ""),
      overrides: parseListValue(fields.get("overrides") ?? ""),
      add: parseListValue(fields.get("add") ?? ""),
      remove: parseListValue(fields.get("remove") ?? ""),
      placeholders: parsePlaceholdersValue(fields.get("placeholders") ?? ""),
    },
    sourcePath,
    body,
  };
}

export function createPromptRegistry(
  sourcePaths: readonly string[] = discoverPromptArtifactFiles(),
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
    for (const targetId of artifact.metadata.add) {
      if (!byId.has(targetId)) {
        throw new Error(
          `unknown add target \`${targetId}\` in prompt artifact ${artifact.sourcePath}`,
        );
      }
    }
    for (const targetId of artifact.metadata.remove) {
      if (!byId.has(targetId)) {
        throw new Error(
          `unknown remove target \`${targetId}\` in prompt artifact ${artifact.sourcePath}`,
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
