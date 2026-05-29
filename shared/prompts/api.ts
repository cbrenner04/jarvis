import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PromptMetadata = {
  id: string;
  behavior: string;
  kind: "step" | "fragment";
  revision: string;
  /** Assembly rank within a behavior; lower renders first, `null` sorts last by id. */
  order: number | null;
  fragmentOf: string[];
  overrides: string[];
  add: string[];
  remove: string[];
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

export type PromptRegistry = {
  getById(id: string): PromptArtifact;
  all(): ReadonlyArray<PromptArtifact>;
};

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

export class PromptRenderingError extends Error {
  constructor(
    public reason:
      | "unknown_placeholder"
      | "missing_value"
      | "type_mismatch"
      | "invalid_placeholder_pattern"
      | "delimiter_violation",
    public details: string,
  ) {
    super(`Prompt rendering error: ${details}`);
    this.name = "PromptRenderingError";
  }
}

export function renderArtifactTemplate(
  artifact: PromptArtifact,
  values: Record<string, unknown>,
): string {
  return renderTemplateWithDeclarations(
    artifact.body,
    artifact.metadata.placeholders,
    values,
  );
}

export function renderTemplateWithDeclarations(
  template: string,
  declarations: ReadonlyArray<PromptPlaceholderDeclaration>,
  values: Record<string, unknown>,
): string {
  const allowed = new Map(declarations.map((d) => [d.name, d]));
  const placeholderPattern = /(?<!<)<([A-Z_][A-Z_0-9]{1,})>(?!>)/g;
  const matches: Array<{
    token: string;
    name: string;
    index: number;
    length: number;
  }> = [];

  let match = placeholderPattern.exec(template);
  while (match !== null) {
    const name = match[1];
    if (name === undefined) {
      throw new PromptRenderingError(
        "invalid_placeholder_pattern",
        "Regex pattern produced undefined placeholder name",
      );
    }
    const token = match[0];
    const declaration = allowed.get(name);
    if (declaration === undefined) {
      throw new PromptRenderingError(
        "unknown_placeholder",
        `Template references unknown placeholder \`${token}\``,
      );
    }
    if (declaration.required && values[name] === undefined) {
      throw new PromptRenderingError(
        "missing_value",
        `Required placeholder \`${token}\` has no value`,
      );
    }
    const value = values[name];
    if (
      value !== undefined &&
      declaration.type === "string" &&
      typeof value !== "string"
    ) {
      throw new PromptRenderingError(
        "type_mismatch",
        `Placeholder \`${token}\` expects string but received ${typeof value}`,
      );
    }
    matches.push({ token, name, index: match.index, length: token.length });
    match = placeholderPattern.exec(template);
  }

  let result = "";
  let lastIndex = 0;
  for (const m of matches) {
    result += template.substring(lastIndex, m.index);
    const value = values[m.name];
    result += typeof value === "string" ? value : "";
    lastIndex = m.index + m.length;
  }
  result += template.substring(lastIndex);
  return result;
}

export function enforceDelimiterPolicy(args: {
  value: string;
  begin: string;
  end: string;
  placeholderName: string;
}): void {
  if (args.value.includes(args.begin) || args.value.includes(args.end)) {
    throw new PromptRenderingError(
      "delimiter_violation",
      `Placeholder <${args.placeholderName}> includes reserved sentinel delimiter`,
    );
  }
}

export function assemblePrompt(args: {
  registry: PromptRegistry;
  globalFragmentIds: string[];
  behaviorFragmentIds: string[];
  stepPromptId: string;
  addFragmentIds?: string[];
  removeFragmentIds?: string[];
}): string {
  const remove = new Set(args.removeFragmentIds ?? []);
  const added = args.addFragmentIds ?? [];
  const orderedIds = [
    ...args.globalFragmentIds,
    ...args.behaviorFragmentIds,
    ...added,
  ].filter((id) => !remove.has(id));
  const fragmentBodies = orderedIds.map((id) =>
    args.registry.getById(id).body.trim(),
  );
  const stepBody = args.registry.getById(args.stepPromptId).body.trim();
  return [...fragmentBodies, stepBody]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export function assemblePromptForStep(args: {
  registry: PromptRegistry;
  stepPromptId: string;
}): string {
  // Fragment ordering is declared per-artifact via the `order` frontmatter field;
  // unranked fragments sort last by id. See v2/docs/prompts.md.
  const sortByContractOrder = (a: string, b: string): number => {
    const ao = args.registry.getById(a).metadata.order;
    const bo = args.registry.getById(b).metadata.order;
    if (ao !== null && bo !== null) return ao - bo || a.localeCompare(b);
    if (ao !== null) return -1;
    if (bo !== null) return 1;
    return a.localeCompare(b);
  };
  const step = args.registry.getById(args.stepPromptId);
  const stepBehavior = step.metadata.behavior;
  const globalFragmentIds = args.registry
    .all()
    .filter(
      (artifact) =>
        artifact.metadata.kind === "fragment" &&
        artifact.metadata.behavior === "global",
    )
    .map((artifact) => artifact.metadata.id)
    .sort(sortByContractOrder);
  const behaviorFragmentIds = args.registry
    .all()
    .filter(
      (artifact) =>
        artifact.metadata.kind === "fragment" &&
        artifact.metadata.behavior === stepBehavior,
    )
    .map((artifact) => artifact.metadata.id)
    .sort(sortByContractOrder);
  return assemblePrompt({
    registry: args.registry,
    globalFragmentIds,
    behaviorFragmentIds,
    stepPromptId: args.stepPromptId,
    addFragmentIds: step.metadata.add,
    removeFragmentIds: step.metadata.remove,
  });
}
