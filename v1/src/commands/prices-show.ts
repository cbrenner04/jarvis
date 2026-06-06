import type { Io } from "../cli.ts";
import { loadPrices, type Prices } from "../prices/load.ts";

export type PricesShowCommandOptions = {
  io: Io;
};

function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) {
    return "—";
  }
  return `$${(rate / 1).toFixed(2)}`;
}

function padRight(str: string, width: number): string {
  return str + " ".repeat(Math.max(0, width - str.length));
}

function padLeft(str: string, width: number): string {
  return " ".repeat(Math.max(0, width - str.length)) + str;
}

export function pricesShowCommand(opts: PricesShowCommandOptions): number {
  const { io } = opts;

  let prices: Prices;
  try {
    prices = loadPrices();
  } catch (err) {
    io.stderr(`jarvis1: failed to load prices: ${(err as Error).message}\n`);
    return 1;
  }

  // Get sorted model IDs
  const modelIds = Object.keys(prices.models).sort();

  if (modelIds.length === 0) {
    io.stdout("(no models in pricing table)\n");
    return 0;
  }

  // Prepare table data
  const rows = modelIds.map((modelId) => {
    const row = prices.models[modelId] as Prices["models"][string];
    return {
      modelId,
      input: formatRate(row.input_per_mtok),
      output: formatRate(row.output_per_mtok),
      cacheRead: formatRate(row.cache_read_per_mtok),
      cacheWrite: formatRate(row.cache_write_per_mtok),
      asOf: row.as_of,
      manual: row.manual ? "*" : "",
      sourceUrl: row.source_url,
    };
  });

  // Calculate column widths
  const columnWidths = {
    model: Math.max("MODEL".length, ...rows.map((r) => r.modelId.length)),
    input: Math.max("INPUT".length, ...rows.map((r) => r.input.length)),
    output: Math.max("OUTPUT".length, ...rows.map((r) => r.output.length)),
    cacheRead: Math.max("CACHE_R".length, ...rows.map((r) => r.cacheRead.length)),
    cacheWrite: Math.max("CACHE_W".length, ...rows.map((r) => r.cacheWrite.length)),
    asOf: Math.max("AS_OF".length, ...rows.map((r) => r.asOf.length)),
    manual: Math.max("MANUAL".length, ...rows.map((r) => r.manual.length)),
    source: "SOURCE".length, // SOURCE is at the end, no need to measure
  };

  // Print header
  const headerRow = [
    padRight("MODEL", columnWidths.model),
    padRight("INPUT", columnWidths.input),
    padRight("OUTPUT", columnWidths.output),
    padRight("CACHE_R", columnWidths.cacheRead),
    padRight("CACHE_W", columnWidths.cacheWrite),
    padRight("AS_OF", columnWidths.asOf),
    padRight("MANUAL", columnWidths.manual),
    "SOURCE",
  ].join("  ");

  io.stdout(`${headerRow}\n`);

  // Print data rows
  for (const row of rows) {
    const dataRow = [
      padRight(row.modelId, columnWidths.model),
      padLeft(row.input, columnWidths.input),
      padLeft(row.output, columnWidths.output),
      padLeft(row.cacheRead, columnWidths.cacheRead),
      padLeft(row.cacheWrite, columnWidths.cacheWrite),
      padRight(row.asOf, columnWidths.asOf),
      padRight(row.manual, columnWidths.manual),
      row.sourceUrl,
    ].join("  ");
    io.stdout(`${dataRow}\n`);
  }

  return 0;
}
