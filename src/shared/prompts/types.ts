export type PromptVariantSubstitution = {
  anchor: string;
  replacement: string;
  replaceAll?: boolean;
};

export type PromptOptionalSection = {
  header: string;
  begin: string;
  end: string;
  placeholder: string;
};

/**
 * Which fragments a step prompt assembles ahead of its body: `global` = ranked global fragments,
 * `behavior` = globals plus the step's behavior lane, `none` = body only. `add`/`remove` apply
 * after the policy in every case. Fragments carry `null`.
 */
export type FragmentPolicy = "global" | "behavior" | "none";

export type PromptMetadata = {
  id: string;
  behavior: string;
  kind: "step" | "fragment";
  fragmentPolicy: FragmentPolicy | null;
  revision: string;
  /** Assembly rank within a behavior; lower renders first, `null` sorts last by id. */
  order: number | null;
  fragmentOf: string[];
  overrides: string[];
  add: string[];
  remove: string[];
  placeholders: PromptPlaceholderDeclaration[];
  variants: Record<string, PromptVariantSubstitution[]>;
  optionalSections: PromptOptionalSection[];
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
