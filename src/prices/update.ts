import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Io } from "../cli.ts";
import {
  fetchModelsDev,
  HttpError,
  type ModelsDevResponse,
  NetworkError,
  ParseError,
} from "./fetch.ts";
import { loadPrices, type PriceRow, type Prices } from "./load.ts";
import { MODELS_DEV_ID } from "./models-dev-map.ts";

export type RunPricesUpdateOptions = {
  io: Io;
  pricesPath?: string;
  fetcher?: (url: string) => Promise<ModelsDevResponse>;
};

const DEFAULT_PRICES_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "data",
  "prices.json",
);

export async function runPricesUpdate(
  opts: RunPricesUpdateOptions,
): Promise<number> {
  const {
    io,
    pricesPath = DEFAULT_PRICES_PATH,
    fetcher = fetchModelsDev,
  } = opts;

  // Load current prices
  let currentPrices: Prices;
  try {
    currentPrices = loadPrices(pricesPath);
  } catch (err) {
    io.stderr(`Error loading prices: ${(err as Error).message}\n`);
    return 1;
  }

  // Fetch from models.dev
  io.stderr("fetching https://models.dev/api.json ...\n");
  let modelsDevData: ModelsDevResponse;
  try {
    modelsDevData = await fetcher("https://models.dev/api.json");
  } catch (err) {
    if (err instanceof NetworkError) {
      io.stderr(`Network error: ${err.message}\n`);
    } else if (err instanceof HttpError) {
      io.stderr(`HTTP error ${err.status} fetching from ${err.url}\n`);
    } else if (err instanceof ParseError) {
      io.stderr(`Parse error: ${err.message}\n`);
    } else {
      io.stderr(`Error fetching from models.dev: ${(err as Error).message}\n`);
    }
    return 1;
  }

  // Build a lookup of models.dev data by their IDs
  const modelsDevById = new Map<string, (typeof modelsDevData.data)[0]>();
  for (const model of modelsDevData.data) {
    modelsDevById.set(model.id, model);
  }

  // Prepare output sections
  const updated: Array<[string, PriceRow, string]> = []; // [modelId, newRow, rateString]
  const unchanged: string[] = [];
  const skippedManual: Array<[string, string | undefined]> = []; // [modelId, manual_note]
  const noUpstreamData: Array<[string, string]> = []; // [modelId, modelsDevId]

  // Track if any row changed
  let anyChanged = false;

  // Process each model in our current prices
  for (const [ourModelId, currentRow] of Object.entries(currentPrices.models)) {
    // Skip manual rows
    if (currentRow.manual) {
      skippedManual.push([ourModelId, currentRow.manual_note]);
      continue;
    }

    // Look up in models.dev
    const modelsDevId = MODELS_DEV_ID[ourModelId];
    if (!modelsDevId) {
      // Model is not in our mapping; skip it (we only update known models)
      unchanged.push(ourModelId);
      continue;
    }

    const modelsDevModel = modelsDevById.get(modelsDevId);
    if (!modelsDevModel) {
      // Not found in upstream
      noUpstreamData.push([ourModelId, modelsDevId]);
      continue;
    }

    const pricing = modelsDevModel.pricing;
    if (!pricing) {
      // No pricing data
      unchanged.push(ourModelId);
      continue;
    }

    // Build new row with updated rates
    const newRow: PriceRow = { ...currentRow };

    // Update input/output rates
    if (pricing.input_cost_per_mtok !== undefined) {
      newRow.input_per_mtok = pricing.input_cost_per_mtok;
    }
    if (pricing.output_cost_per_mtok !== undefined) {
      newRow.output_per_mtok = pricing.output_cost_per_mtok;
    }

    // Handle cache rates: only update if provided upstream, otherwise preserve local
    if (pricing.cache_read_cost_per_mtok !== undefined) {
      newRow.cache_read_per_mtok = pricing.cache_read_cost_per_mtok;
    }
    if (pricing.cache_creation_cost_per_mtok !== undefined) {
      newRow.cache_write_per_mtok = pricing.cache_creation_cost_per_mtok;
    }

    // Set source_url and as_of
    newRow.source_url = `https://models.dev/models/${modelsDevId}`;
    newRow.as_of = getToday();

    // Check if rates actually changed (not metadata)
    const hasChanged =
      newRow.input_per_mtok !== currentRow.input_per_mtok ||
      newRow.output_per_mtok !== currentRow.output_per_mtok ||
      newRow.cache_read_per_mtok !== currentRow.cache_read_per_mtok ||
      newRow.cache_write_per_mtok !== currentRow.cache_write_per_mtok;

    if (hasChanged) {
      anyChanged = true;
      const rateString = formatRates(newRow);
      updated.push([ourModelId, newRow, rateString]);
      currentPrices.models[ourModelId] = newRow;
    } else {
      unchanged.push(ourModelId);
    }
  }

  // Output sections
  if (updated.length > 0) {
    io.stderr("updated:\n");
    for (const [modelId, , rateString] of updated) {
      io.stderr(`  ${modelId.padEnd(20)} ${rateString}\n`);
    }
  }

  if (unchanged.length > 0) {
    io.stderr(`unchanged: ${unchanged.length} rows already current\n`);
  }

  if (skippedManual.length > 0) {
    io.stderr("skipped (manual override):\n");
    for (const [modelId, note] of skippedManual) {
      if (note) {
        io.stderr(
          `  ${modelId.padEnd(20)} (manual_note: ${JSON.stringify(note)})\n`,
        );
      } else {
        io.stderr(`  ${modelId}\n`);
      }
    }
  }

  if (noUpstreamData.length > 0) {
    io.stderr("no upstream data:\n");
    for (const [modelId, modelsDevId] of noUpstreamData) {
      io.stderr(
        `  ${modelId.padEnd(20)} (not found in models.dev under id: ${modelsDevId})\n`,
      );
    }
  }

  // Write file if anything changed
  if (anyChanged) {
    // Create a backup in case validation fails
    let backupContent: string | null = null;
    try {
      backupContent = readFileSync(pricesPath, "utf8");
    } catch {
      // If we can't read the current file, that's fine; there's nothing to restore
    }

    try {
      const newContent = `${JSON.stringify(currentPrices, null, 2)}\n`;
      writeFileSync(pricesPath, newContent, "utf8");

      // Validate the written file
      try {
        loadPrices(pricesPath);
      } catch (validationErr) {
        // Validation failed; restore backup if we have one
        if (backupContent !== null) {
          try {
            writeFileSync(pricesPath, backupContent, "utf8");
          } catch {
            // Couldn't restore backup; we're in a bad state
          }
        }
        io.stderr(
          `Validation failed after writing: ${(validationErr as Error).message}\n`,
        );
        return 2;
      }

      io.stderr(`wrote: ${pricesPath}\n`);
    } catch (err) {
      io.stderr(`Failed to write prices file: ${(err as Error).message}\n`);
      return 1;
    }
  }

  return 0;
}

function getToday(): string {
  const now = new Date();
  // UTC date in YYYY-MM-DD format
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatRates(row: PriceRow): string {
  const parts: string[] = [];

  if (row.input_per_mtok !== null && row.input_per_mtok !== undefined) {
    parts.push(`input $${row.input_per_mtok.toFixed(2)}/Mtok`);
  }

  if (row.output_per_mtok !== null && row.output_per_mtok !== undefined) {
    parts.push(`output $${row.output_per_mtok.toFixed(2)}/Mtok`);
  }

  if (
    row.cache_read_per_mtok !== null &&
    row.cache_read_per_mtok !== undefined
  ) {
    parts.push(`cache_read $${row.cache_read_per_mtok.toFixed(2)}`);
  }

  if (
    row.cache_write_per_mtok !== null &&
    row.cache_write_per_mtok !== undefined
  ) {
    parts.push(`cache_write $${row.cache_write_per_mtok.toFixed(2)}`);
  }

  return parts.join("  ");
}
