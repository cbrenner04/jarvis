import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PromptArtifact,
  PromptOptionalSection,
  PromptPlaceholderDeclaration,
  PromptPlaceholderType,
  PromptRegistry,
  PromptVariantSubstitution,
} from "./types.ts";

const PROMPTS_DIR = join(import.meta.dir, "..", "..", "prompts");
const REGISTRY_MANIFEST = join(PROMPTS_DIR, "registry.txt");

/**
 * Read the explicit prompt seed list from `prompts/registry.txt`: one artifact
 * path per line, relative to `prompts/`. No path scanning — registration is an
 * auditable manifest so adding a prompt is a deliberate one-line edit.
 */
function seededPromptArtifactFiles(dir: string = PROMPTS_DIR): string[] {
  return readFileSync(REGISTRY_MANIFEST, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((entry) => join(dir, entry));
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
      throw new Error(`invalid placeholder declaration \`${entry}\`; expected NAME:string or NAME:string!`);
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

function requireField(fields: Map<string, string>, field: string, sourcePath: string): string {
  const value = fields.get(field);
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required metadata \`${field}\` in prompt artifact ${sourcePath}`);
  }
  return value;
}

function parseJsonField(value: string | undefined, field: string, sourcePath: string): unknown {
  if (value === undefined || value.length === 0) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`invalid JSON for \`${field}\` in prompt artifact ${sourcePath}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVariantSubstitution(
  entry: unknown,
  variantId: string,
  index: number,
  sourcePath: string,
): PromptVariantSubstitution {
  if (!isPlainObject(entry)) {
    throw new Error(
      `invalid variant substitution at index ${index} for variant \`${variantId}\` in prompt artifact ${sourcePath}`,
    );
  }
  const anchor = entry.anchor;
  const replacement = entry.replacement;
  if (typeof anchor !== "string" || typeof replacement !== "string") {
    throw new Error(
      `invalid variant substitution at index ${index} for variant \`${variantId}\` in prompt artifact ${sourcePath}; expected string anchor and replacement`,
    );
  }
  const replaceAll = entry.replaceAll;
  if (replaceAll !== undefined && typeof replaceAll !== "boolean") {
    throw new Error(
      `invalid variant substitution at index ${index} for variant \`${variantId}\` in prompt artifact ${sourcePath}; replaceAll must be boolean`,
    );
  }
  return replaceAll === undefined ? { anchor, replacement } : { anchor, replacement, replaceAll };
}

function parseVariantsValue(
  value: string | undefined,
  sourcePath: string,
): Record<string, PromptVariantSubstitution[]> {
  const parsed = parseJsonField(value, "variants", sourcePath);
  if (parsed === undefined) return {};
  if (!isPlainObject(parsed)) {
    throw new Error(`invalid variants in prompt artifact ${sourcePath}; expected a JSON object`);
  }
  const variants: Record<string, PromptVariantSubstitution[]> = {};
  for (const [variantId, entries] of Object.entries(parsed)) {
    if (variantId.length === 0) {
      throw new Error(`invalid variants in prompt artifact ${sourcePath}; variant id must not be empty`);
    }
    if (!Array.isArray(entries)) {
      throw new Error(`invalid variants in prompt artifact ${sourcePath}; variant \`${variantId}\` must be an array`);
    }
    variants[variantId] = entries.map((entry, index) => parseVariantSubstitution(entry, variantId, index, sourcePath));
  }
  return variants;
}

function parseOptionalSection(entry: unknown, index: number, sourcePath: string): PromptOptionalSection {
  if (!isPlainObject(entry)) {
    throw new Error(`invalid optionalSections entry at index ${index} in prompt artifact ${sourcePath}`);
  }
  const header = entry.header;
  const begin = entry.begin;
  const end = entry.end;
  const placeholder = entry.placeholder;
  if (
    typeof header !== "string" ||
    typeof begin !== "string" ||
    typeof end !== "string" ||
    typeof placeholder !== "string"
  ) {
    throw new Error(
      `invalid optionalSections entry at index ${index} in prompt artifact ${sourcePath}; expected string header, begin, end, and placeholder`,
    );
  }
  return { header, begin, end, placeholder };
}

function parseOptionalSectionsValue(value: string | undefined, sourcePath: string): PromptOptionalSection[] {
  const parsed = parseJsonField(value, "optionalSections", sourcePath);
  if (parsed === undefined) return [];
  if (!Array.isArray(parsed)) {
    throw new Error(`invalid optionalSections in prompt artifact ${sourcePath}; expected a JSON array`);
  }
  return parsed.map((entry, index) => parseOptionalSection(entry, index, sourcePath));
}

function validateOptionalSectionPlaceholders(
  optionalSections: PromptOptionalSection[],
  placeholders: PromptPlaceholderDeclaration[],
  sourcePath: string,
): void {
  const declared = new Set(placeholders.map((placeholder) => placeholder.name));
  for (const section of optionalSections) {
    if (!declared.has(section.placeholder)) {
      throw new Error(
        `optionalSections placeholder \`${section.placeholder}\` is not declared in placeholders in prompt artifact ${sourcePath}`,
      );
    }
  }
}

function parseOrderValue(value: string | undefined, sourcePath: string): number | null {
  if (value === undefined || value.length === 0) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`invalid order \`${value}\` in prompt artifact ${sourcePath}; expected an integer`);
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
    throw new Error(`invalid kind \`${kind}\` in prompt artifact ${sourcePath}; expected step|fragment`);
  }

  const placeholders = parsePlaceholdersValue(fields.get("placeholders") ?? "");
  const optionalSections = parseOptionalSectionsValue(fields.get("optionalSections"), sourcePath);
  validateOptionalSectionPlaceholders(optionalSections, placeholders, sourcePath);

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
      placeholders,
      variants: parseVariantsValue(fields.get("variants"), sourcePath),
      optionalSections,
    },
    sourcePath,
    body,
  };
}

export function createPromptRegistry(sourcePaths: readonly string[] = seededPromptArtifactFiles()): PromptRegistry {
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
        throw new Error(`unknown explicit override target \`${targetId}\` in prompt artifact ${artifact.sourcePath}`);
      }
    }
    for (const targetId of artifact.metadata.add) {
      if (!byId.has(targetId)) {
        throw new Error(`unknown add target \`${targetId}\` in prompt artifact ${artifact.sourcePath}`);
      }
    }
    for (const targetId of artifact.metadata.remove) {
      if (!byId.has(targetId)) {
        throw new Error(`unknown remove target \`${targetId}\` in prompt artifact ${artifact.sourcePath}`);
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
