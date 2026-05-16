import { existsSync, readFileSync } from "node:fs";
import type { CostSource, TelemetryRecord, UsageSource } from "./telemetry.ts";

type RunSummaryArgs = {
  telemetryPath: string | null;
  namespace: string;
  startTs: string;
  exitReason: string;
  iterations: number;
  durationMs: number;
  specPath: string;
};

type AgentAggregate = {
  agent: string;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  knownCostUsd: number;
  knownCostCount: number;
  unavailableUsageCount: number;
  noPriceCount: number;
  parseWarningCount: number;
  nullCostCount: number;
  costSources: Set<string>;
};

function toNumber(value: number | null | undefined): number {
  return value ?? 0;
}

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

function formatMoney(n: number | null): string {
  if (n === null) {
    return "—";
  }
  return `$${n.toFixed(2)}`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function normalizeSource(source: CostSource | null | undefined): string {
  if (source === "agent" || source === "computed" || source === "no-price") {
    return source;
  }
  return "unavailable";
}

function dominantSource(sources: Set<string>): string {
  if (sources.has("agent")) {
    return "agent";
  }
  if (sources.has("computed")) {
    return "computed";
  }
  if (sources.has("no-price")) {
    return "no-price";
  }
  return "unavailable";
}

export function runSummary(args: RunSummaryArgs): string {
  const lines: string[] = [];
  lines.push("─── run summary ───");
  lines.push(`spec: ${args.specPath}`);
  lines.push(`exit reason: ${args.exitReason}`);
  lines.push(`iterations: ${args.iterations}`);
  lines.push(`duration: ${formatDuration(args.durationMs)}`);
  lines.push("");

  if (args.telemetryPath === null || !existsSync(args.telemetryPath)) {
    lines.push("(no telemetry records found for this run)");
    return `${lines.join("\n")}\n`;
  }

  const raw = readFileSync(args.telemetryPath, "utf8");
  const runRecords: TelemetryRecord[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as TelemetryRecord;
      if (parsed.namespace !== args.namespace || parsed.ts < args.startTs) {
        continue;
      }
      runRecords.push(parsed);
    } catch {
      // Ignore malformed lines.
    }
  }

  if (runRecords.length === 0) {
    lines.push("(no telemetry records found for this run)");
    return `${lines.join("\n")}\n`;
  }

  const perAgent = new Map<string, AgentAggregate>();
  for (const record of runRecords) {
    const existing = perAgent.get(record.agent);
    const aggregate: AgentAggregate =
      existing ??
      ({
        agent: record.agent,
        iterations: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        knownCostUsd: 0,
        knownCostCount: 0,
        unavailableUsageCount: 0,
        noPriceCount: 0,
        parseWarningCount: 0,
        nullCostCount: 0,
        costSources: new Set<string>(),
      } satisfies AgentAggregate);

    aggregate.iterations += 1;
    aggregate.inputTokens += toNumber(record.usage?.input_tokens);
    aggregate.outputTokens += toNumber(record.usage?.output_tokens);
    aggregate.cacheReadTokens += toNumber(
      record.usage?.cache_read_input_tokens,
    );
    aggregate.cacheWriteTokens += toNumber(
      record.usage?.cache_creation_input_tokens,
    );

    if (record.cost_usd === null || record.cost_usd === undefined) {
      aggregate.nullCostCount += 1;
    } else {
      aggregate.knownCostUsd += record.cost_usd;
      aggregate.knownCostCount += 1;
    }

    const source = normalizeSource(record.cost_source);
    aggregate.costSources.add(source);

    if (record.usage_source === ("unavailable" satisfies UsageSource)) {
      aggregate.unavailableUsageCount += 1;
    }
    if (
      record.usage_source === ("agent" satisfies UsageSource) &&
      record.cost_source === ("no-price" satisfies CostSource)
    ) {
      aggregate.noPriceCount += 1;
    }
    if (record.warnings !== undefined && record.warnings.length > 0) {
      aggregate.parseWarningCount += 1;
    }

    perAgent.set(record.agent, aggregate);
  }

  const rows = [...perAgent.values()].sort((a, b) =>
    a.agent.localeCompare(b.agent),
  );
  const showCacheColumns = rows.some(
    (row) => row.cacheReadTokens > 0 || row.cacheWriteTokens > 0,
  );

  const headerColumns = [
    "agent",
    "tokens_in",
    "tokens_out",
    ...(showCacheColumns ? ["cache_r", "cache_w"] : []),
    "cost",
    "source",
  ];

  const table: string[][] = [];
  table.push(headerColumns);

  for (const row of rows) {
    table.push([
      `${row.agent} (${row.iterations} iters)`,
      formatInt(row.inputTokens),
      formatInt(row.outputTokens),
      ...(showCacheColumns
        ? [formatInt(row.cacheReadTokens), formatInt(row.cacheWriteTokens)]
        : []),
      formatMoney(row.knownCostCount > 0 ? row.knownCostUsd : null),
      dominantSource(row.costSources),
    ]);
  }

  const totalInput = rows.reduce((sum, row) => sum + row.inputTokens, 0);
  const totalOutput = rows.reduce((sum, row) => sum + row.outputTokens, 0);
  const totalCacheRead = rows.reduce(
    (sum, row) => sum + row.cacheReadTokens,
    0,
  );
  const totalCacheWrite = rows.reduce(
    (sum, row) => sum + row.cacheWriteTokens,
    0,
  );
  const totalKnownCost = rows.reduce((sum, row) => sum + row.knownCostUsd, 0);
  const totalKnownCostCount = rows.reduce(
    (sum, row) => sum + row.knownCostCount,
    0,
  );

  table.push([
    "total",
    formatInt(totalInput),
    formatInt(totalOutput),
    ...(showCacheColumns
      ? [formatInt(totalCacheRead), formatInt(totalCacheWrite)]
      : []),
    formatMoney(totalKnownCostCount > 0 ? totalKnownCost : null),
    "",
  ]);

  const headerRow = table[0];
  if (headerRow === undefined) {
    return `${lines.join("\n")}\n`;
  }
  const widths = headerRow.map((_, col) =>
    Math.max(...table.map((row) => row[col]?.length ?? 0)),
  );
  for (let i = 0; i < table.length; i += 1) {
    const row = table[i];
    if (row === undefined) {
      continue;
    }
    const rendered = row
      .map((cell, col) => cell.padEnd(widths[col] ?? 0))
      .join("  ")
      .trimEnd();
    lines.push(rendered);
    if (i === table.length - 2) {
      lines.push("─".repeat(rendered.length));
    }
  }

  const notes: string[] = [];
  for (const row of rows) {
    if (row.unavailableUsageCount > 0) {
      notes.push(
        `${row.unavailableUsageCount} iteration(s) under ${row.agent} had no usage data (usage_source=unavailable).`,
      );
    }
    if (row.noPriceCount > 0) {
      notes.push(
        `${row.noPriceCount} iteration(s) under ${row.agent} had usage data but no price-table entry for the model.`,
      );
    }
    if (row.parseWarningCount > 0) {
      notes.push(
        `${row.parseWarningCount} iteration(s) under ${row.agent} recorded parse warnings.`,
      );
    }
    if (row.costSources.size > 1) {
      notes.push(
        `${row.agent} mixes cost sources: ${[...row.costSources].join(", ")}.`,
      );
    }
  }

  const totalNullCostCount = rows.reduce(
    (sum, row) => sum + row.nullCostCount,
    0,
  );
  if (totalNullCostCount > 0) {
    notes.push(
      `${totalNullCostCount} iteration(s) had null cost and were excluded from total cost.`,
    );
  }

  if (notes.length > 0) {
    lines.push("");
    lines.push("notes:");
    for (const note of notes) {
      lines.push(`  - ${note}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
