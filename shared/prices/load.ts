import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PriceRow = {
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  cache_read_per_mtok?: number | null;
  cache_write_per_mtok?: number | null;
  source_url: string;
  as_of: string;
  manual?: boolean;
  manual_note?: string;
  [key: string]: unknown; // forward-compat: unknown fields are preserved
};

export type Prices = {
  version: number;
  models: Record<string, PriceRow>;
};

function readCatalog(resolvedPath: string): Record<string, unknown> {
  let content: string;
  try {
    content = readFileSync(resolvedPath, "utf8");
  } catch (err) {
    throw new Error(`Failed to read prices file at ${resolvedPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Invalid JSON in prices file at ${resolvedPath}: ${(err as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Prices file at ${resolvedPath} must be a JSON object, got ${typeof parsed}`);
  }

  return parsed as Record<string, unknown>;
}

// `optional` distinguishes the required rate columns (which must be present as
// number|null) from the cache columns, which may be absent entirely.
function assertRate(value: unknown, field: string, modelId: string, optional: boolean): void {
  if (optional && value === undefined) {
    return;
  }
  if (value !== null && typeof value !== "number") {
    throw new Error(`${field} for model ${JSON.stringify(modelId)} must be a number or null, got ${typeof value}`);
  }
  if (typeof value === "number" && value < 0) {
    throw new Error(`${field} for model ${JSON.stringify(modelId)} must be non-negative, got ${value}`);
  }
}

function assertString(value: unknown, field: string, modelId: string): void {
  if (typeof value !== "string") {
    throw new Error(`${field} for model ${JSON.stringify(modelId)} must be a string, got ${typeof value}`);
  }
}

function validateRow(rowRaw: unknown, modelId: string): PriceRow {
  if (rowRaw === null || typeof rowRaw !== "object" || Array.isArray(rowRaw)) {
    throw new Error(`Price row for model ${JSON.stringify(modelId)} must be an object`);
  }

  const row = rowRaw as Record<string, unknown>;

  assertRate(row.input_per_mtok, "input_per_mtok", modelId, false);
  assertRate(row.output_per_mtok, "output_per_mtok", modelId, false);
  assertRate(row.cache_read_per_mtok, "cache_read_per_mtok", modelId, true);
  assertRate(row.cache_write_per_mtok, "cache_write_per_mtok", modelId, true);
  assertString(row.source_url, "source_url", modelId);
  assertString(row.as_of, "as_of", modelId);

  return row as PriceRow;
}

export function loadPrices(path?: string): Prices {
  const resolvedPath = path ?? join(import.meta.dir, "..", "..", "data", "prices.json");
  const obj = readCatalog(resolvedPath);

  if (obj.version !== 1) {
    throw new Error(`Prices file at ${resolvedPath} has unknown version ${JSON.stringify(obj.version)} (expected 1)`);
  }

  const modelsRaw = obj.models;
  if (modelsRaw === null || typeof modelsRaw !== "object" || Array.isArray(modelsRaw)) {
    throw new Error(`models field in prices file at ${resolvedPath} must be an object`);
  }

  const models: Record<string, PriceRow> = {};
  for (const [modelId, rowRaw] of Object.entries(modelsRaw as Record<string, unknown>)) {
    models[modelId] = validateRow(rowRaw, modelId);
  }

  return {
    version: obj.version as number,
    models,
  };
}
