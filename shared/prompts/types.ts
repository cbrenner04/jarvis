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

export type PromptRegistry = {
  getById(id: string): PromptArtifact;
  all(): ReadonlyArray<PromptArtifact>;
};
