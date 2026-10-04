/**
 * One cross-library evidence contract for operator-facing failures: what the harness expected,
 * what it observed, an optional near miss, whether a retry can change the answer, and the paths
 * the evidence references with their ownership. Run rows and pipeline stages persist this shape;
 * `parseOperatorFailureRecord` is the only way stored JSON becomes a record.
 */

export type OperatorFailurePathOrigin = "harness-internal" | "operator-repository";

export type OperatorFailureReferencedPath = {
  path: string;
  origin: OperatorFailurePathOrigin;
};

export type OperatorFailureRecord = {
  expectation: string;
  observation: string;
  nearMiss?: string;
  retryable: boolean;
  referencedPaths: OperatorFailureReferencedPath[];
};

export type OperatorFailureRecordParseResult =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "valid"; record: OperatorFailureRecord };

const PATH_ORIGINS: ReadonlySet<string> = new Set<OperatorFailurePathOrigin>([
  "harness-internal",
  "operator-repository",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function referencedPathFromUnknown(value: unknown): OperatorFailureReferencedPath | undefined {
  if (!isPlainObject(value)) return undefined;
  if (typeof value.path !== "string" || typeof value.origin !== "string" || !PATH_ORIGINS.has(value.origin)) {
    return undefined;
  }
  return { path: value.path, origin: value.origin as OperatorFailurePathOrigin };
}

/** Structural validation of an already-decoded value; `undefined` for anything that is not a complete record. */
export function operatorFailureRecordFromUnknown(value: unknown): OperatorFailureRecord | undefined {
  if (!isPlainObject(value)) return undefined;
  if (typeof value.expectation !== "string" || typeof value.observation !== "string") return undefined;
  if (typeof value.retryable !== "boolean") return undefined;
  if (value.nearMiss !== undefined && typeof value.nearMiss !== "string") return undefined;
  if (!Array.isArray(value.referencedPaths)) return undefined;
  const referencedPaths: OperatorFailureReferencedPath[] = [];
  for (const entry of value.referencedPaths) {
    const referenced = referencedPathFromUnknown(entry);
    if (referenced === undefined) return undefined;
    referencedPaths.push(referenced);
  }
  return {
    expectation: value.expectation,
    observation: value.observation,
    ...(value.nearMiss !== undefined ? { nearMiss: value.nearMiss } : {}),
    retryable: value.retryable,
    referencedPaths,
  };
}

/** Non-throwing decode of a stored JSON column: `absent` for `null`, `invalid` for malformed syntax or shape. */
export function parseOperatorFailureRecord(json: string | null): OperatorFailureRecordParseResult {
  if (json === null) return { kind: "absent" };
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    return { kind: "invalid" };
  }
  const record = operatorFailureRecordFromUnknown(decoded);
  return record === undefined ? { kind: "invalid" } : { kind: "valid", record };
}
