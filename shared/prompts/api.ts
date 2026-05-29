import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PromptMetadata = {
  id: string;
  behavior: string;
  kind: "step" | "fragment";
  revision: string;
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

const PROMPT_ARTIFACT_FILES = [
  join(import.meta.dir, "..", "..", "prompts", "global", "terse.md"),
  join(import.meta.dir, "..", "..", "prompts", "global", "documentation.md"),
  join(import.meta.dir, "..", "..", "prompts", "global", "naming.md"),
  join(import.meta.dir, "..", "..", "prompts", "patch", "instructions.md"),
  join(import.meta.dir, "..", "..", "prompts", "patch", "rules.md"),
  join(import.meta.dir, "..", "..", "prompts", "plan", "draft.md"),
  join(import.meta.dir, "..", "..", "prompts", "plan", "decisions-ledger.md"),
  join(import.meta.dir, "..", "..", "prompts", "plan", "defer-to-consumer.md"),
  join(import.meta.dir, "..", "..", "prompts", "plan", "review.md"),
  join(import.meta.dir, "..", "..", "prompts", "plan", "refine.md"),
  join(import.meta.dir, "..", "..", "prompts", "write", "execute.md"),
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
  const add = parseListValue(fields.get("add") ?? "");
  const remove = parseListValue(fields.get("remove") ?? "");
  const placeholders = parsePlaceholdersValue(fields.get("placeholders") ?? "");
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
      fragmentOf,
      overrides,
      add,
      remove,
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
  sourcePaths: readonly string[] = PROMPT_ARTIFACT_FILES,
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
  const ORDER_INDEX: Record<string, number> = {
    "global.documentation": 0,
    "global.naming": 1,
    "global.terse": 2,
    "plan.decisions-ledger": 0,
    "plan.defer-to-consumer": 1,
    // write currently has no behavior fragments; write.execute is the step prompt.
  };
  const sortByContractOrder = (a: string, b: string): number => {
    const ai = ORDER_INDEX[a];
    const bi = ORDER_INDEX[b];
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
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
