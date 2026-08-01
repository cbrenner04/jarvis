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

export function loadPrices(path?: string): Prices {
  const resolvedPath = path ?? join(import.meta.dir, "..", "..", "data", "prices.json");

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

  const obj = parsed as Record<string, unknown>;

  if (obj.version !== 1) {
    throw new Error(`Prices file at ${resolvedPath} has unknown version ${JSON.stringify(obj.version)} (expected 1)`);
  }

  const modelsRaw = obj.models;
  if (modelsRaw === null || typeof modelsRaw !== "object" || Array.isArray(modelsRaw)) {
    throw new Error(`models field in prices file at ${resolvedPath} must be an object`);
  }

  const models: Record<string, PriceRow> = {};
  for (const [modelId, rowRaw] of Object.entries(modelsRaw as Record<string, unknown>)) {
    if (rowRaw === null || typeof rowRaw !== "object" || Array.isArray(rowRaw)) {
      throw new Error(`Price row for model ${JSON.stringify(modelId)} must be an object`);
    }

    const row = rowRaw as Record<string, unknown>;

    const inputRate = row.input_per_mtok;
    if (inputRate !== null && typeof inputRate !== "number") {
      throw new Error(
        `input_per_mtok for model ${JSON.stringify(modelId)} must be a number or null, got ${typeof inputRate}`,
      );
    }
    if (typeof inputRate === "number" && inputRate < 0) {
      throw new Error(`input_per_mtok for model ${JSON.stringify(modelId)} must be non-negative, got ${inputRate}`);
    }

    const outputRate = row.output_per_mtok;
    if (outputRate !== null && typeof outputRate !== "number") {
      throw new Error(
        `output_per_mtok for model ${JSON.stringify(modelId)} must be a number or null, got ${typeof outputRate}`,
      );
    }
    if (typeof outputRate === "number" && outputRate < 0) {
      throw new Error(`output_per_mtok for model ${JSON.stringify(modelId)} must be non-negative, got ${outputRate}`);
    }

    const cacheReadRate = row.cache_read_per_mtok;
    if (cacheReadRate !== undefined && cacheReadRate !== null && typeof cacheReadRate !== "number") {
      throw new Error(
        `cache_read_per_mtok for model ${JSON.stringify(modelId)} must be a number or null, got ${typeof cacheReadRate}`,
      );
    }
    if (typeof cacheReadRate === "number" && cacheReadRate < 0) {
      throw new Error(
        `cache_read_per_mtok for model ${JSON.stringify(modelId)} must be non-negative, got ${cacheReadRate}`,
      );
    }

    const cacheWriteRate = row.cache_write_per_mtok;
    if (cacheWriteRate !== undefined && cacheWriteRate !== null && typeof cacheWriteRate !== "number") {
      throw new Error(
        `cache_write_per_mtok for model ${JSON.stringify(modelId)} must be a number or null, got ${typeof cacheWriteRate}`,
      );
    }
    if (typeof cacheWriteRate === "number" && cacheWriteRate < 0) {
      throw new Error(
        `cache_write_per_mtok for model ${JSON.stringify(modelId)} must be non-negative, got ${cacheWriteRate}`,
      );
    }

    const sourceUrl = row.source_url;
    if (typeof sourceUrl !== "string") {
      throw new Error(`source_url for model ${JSON.stringify(modelId)} must be a string, got ${typeof sourceUrl}`);
    }

    const asOf = row.as_of;
    if (typeof asOf !== "string") {
      throw new Error(`as_of for model ${JSON.stringify(modelId)} must be a string, got ${typeof asOf}`);
    }

    models[modelId] = row as PriceRow;
  }

  return {
    version: obj.version as number,
    models,
  };
}
