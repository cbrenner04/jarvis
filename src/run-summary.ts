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
  cliName: string;
  configuredModels: Set<string>;
  patchIterations: number;
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
  costSourcesAll: Set<string>;
  meaningfulCostSources: Set<string>;
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

/** Rows for the cost table: successful patch completions (telemetry kind ok).*/
function shouldAggregateForCostTable(record: TelemetryRecord): boolean {
  if (record.record_role === "run_terminal") {
    return false;
  }
  if (record.agent === "harness") {
    return false;
  }
  return record.kind === "ok";
}

function attemptLine(record: TelemetryRecord): boolean {
  if (record.record_role === "run_terminal") {
    return false;
  }
  return record.agent !== "harness";
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

function iterationCountLabel(n: number): string {
  return `${n} iteration(s)`;
}

function formatAgentColumn(cli: string, models: Set<string>): string {
  if (models.size === 1) {
    const m = [...models][0];
    if (m !== undefined && m.trim() !== "") {
      return `${cli} (${m})`;
    }
  }
  return cli;
}

function meaningfulSourceForMix(record: TelemetryRecord): string | null {
  if (record.usage_source !== ("agent" satisfies UsageSource)) {
    return null;
  }
  const n = normalizeSource(record.cost_source);
  if (
    n === "agent" ||
    n === "computed" ||
    n === "no-price"
  ) {
    return n;
  }
  return null;
}

function newAggregate(cli: string): AgentAggregate {
  return {
    cliName: cli,
    configuredModels: new Set<string>(),
    patchIterations: 0,
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
    costSourcesAll: new Set<string>(),
    meaningfulCostSources: new Set<string>(),
  };
}

export function runSummary(args: RunSummaryArgs): string {
  const lines: string[] = [];
  lines.push("─── run summary ───");
  lines.push(`spec: ${args.specPath}`);
  lines.push(`exit reason: ${args.exitReason}`);
  lines.push(`iterations: ${args.iterations}`);

  if (args.telemetryPath === null || !existsSync(args.telemetryPath)) {
    lines.push("attempts: 0");
    lines.push(`duration: ${formatDuration(args.durationMs)}`);
    lines.push("");
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

  lines.push(`attempts: ${runRecords.filter(attemptLine).length}`);
  lines.push(`duration: ${formatDuration(args.durationMs)}`);
  lines.push("");

  if (runRecords.length === 0) {
    lines.push("(no telemetry records found for this run)");
    return `${lines.join("\n")}\n`;
  }

  const quotaExcludedByAgent = new Map<string, number>();
  for (const record of runRecords) {
    if (record.kind === "quota") {
      const cli = record.agent;
      quotaExcludedByAgent.set(
        cli,
        (quotaExcludedByAgent.get(cli) ?? 0) + 1,
      );
    }
  }

  const perAgent = new Map<string, AgentAggregate>();

  for (const record of runRecords) {
    if (!shouldAggregateForCostTable(record)) {
      continue;
    }

    const cli = record.agent;
    let aggregate = perAgent.get(cli);
    if (aggregate === undefined) {
      aggregate = newAggregate(cli);
      perAgent.set(cli, aggregate);
    }

    if (record.configured_model?.trim()) {
      aggregate.configuredModels.add(record.configured_model.trim());
    }

    aggregate.patchIterations += 1;
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
    aggregate.costSourcesAll.add(source);

    const mix = meaningfulSourceForMix(record);
    if (mix !== null) {
      aggregate.meaningfulCostSources.add(mix);
    }

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
  }

  const rows = [...perAgent.values()].sort((a, b) =>
    a.cliName.localeCompare(b.cliName),
  );

  const showCacheColumns =
    rows.length > 0 &&
    rows.some(
      (row) => row.cacheReadTokens > 0 || row.cacheWriteTokens > 0,
    );

  if (rows.length > 0) {
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
        `${formatAgentColumn(row.cliName, row.configuredModels)} (${iterationCountLabel(row.patchIterations)})`,
        formatInt(row.inputTokens),
        formatInt(row.outputTokens),
        ...(showCacheColumns
          ? [formatInt(row.cacheReadTokens), formatInt(row.cacheWriteTokens)]
          : []),
        formatMoney(row.knownCostCount > 0 ? row.knownCostUsd : null),
        dominantSource(row.costSourcesAll),
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
    const totalKnownCost = rows.reduce(
      (sum, row) => sum + row.knownCostUsd,
      0,
    );
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
    if (headerRow !== undefined) {
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
    }
  } else if (quotaExcludedByAgent.size === 0) {
    lines.push("(patch cost totals aggregate completed iterations only.)");
  }

  const notes: string[] = [];

  const quotaAgents = [...quotaExcludedByAgent.keys()].sort((a, b) =>
    a.localeCompare(b),
  );
  for (const qa of quotaAgents) {
    const n = quotaExcludedByAgent.get(qa) ?? 0;
    if (n > 0) {
      notes.push(
        `${n} quota attempt(s) under ${qa} were excluded from usage totals.`,
      );
    }
  }

  for (const row of rows) {
    if (row.unavailableUsageCount > 0) {
      notes.push(
        `${row.unavailableUsageCount} iteration(s) under ${row.cliName} had no usage data (usage_source=unavailable).`,
      );
    }
    if (row.noPriceCount > 0) {
      notes.push(
        `${row.noPriceCount} iteration(s) under ${row.cliName} had usage data but no price-table entry for the model.`,
      );
    }
    if (row.parseWarningCount > 0) {
      notes.push(
        `${row.parseWarningCount} iteration(s) under ${row.cliName} recorded parse warnings.`,
      );
    }
    if (row.meaningfulCostSources.size > 1) {
      notes.push(
        `${row.cliName} mixes cost sources: ${[...row.meaningfulCostSources].sort().join(", ")}.`,
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
