import { existsSync, readFileSync } from "node:fs";
import type { CostSource, TelemetryRecord, TelemetryUsage, UsageSource } from "./telemetry.ts";

export const INTAKE_SUGGESTION_URL = "https://github.com/cbrenner04/jarvis/issues/new/choose";

function mapExitReasonToRunbookSection(unsuffixedReason: string): string | null {
  const resumeFirstReasons = new Set(["timeout", "sigint", "worktree-locked"]);
  if (resumeFirstReasons.has(unsuffixedReason)) {
    return "Resume-first guidance";
  }
  if (unsuffixedReason === "criteria-complete") {
    return null;
  }
  return "Recovery by exit reason";
}

type RunSummaryArgs = {
  telemetryPath: string | null;
  namespace: string;
  startTs: string;
  exitReason: string;
  iterations: number;
  durationMs: number;
  specPath: string;
};

export type PlanSummaryArgs = {
  telemetryPath: string | null;
  namespace: string;
  startTs: string;
  exitReason: string;
  durationMs: number;
  specPath: string;
};

export type PromptSummaryArgs = {
  telemetryPath: string | null;
  namespace: string;
  startTs: string;
  exitReason: string;
  durationMs: number;
};

type TelemetrySummaryMode = "patch" | "plan" | "prompt";

type AgentAggregate = {
  cliName: string;
  configuredModels: Set<string>;
  completedOkInvocations: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  knownCostUsd: number;
  knownCostCount: number;
  unavailableUsageCount: number;
  noPriceCount: number;
  estimatedCount: number;
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
  if (source === "agent" || source === "computed" || source === "estimated" || source === "no-price") {
    return source;
  }
  return "unavailable";
}

/** Rows for the cost table: successful completions (telemetry kind ok).*/
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

function isImplementationAttempt(record: TelemetryRecord): boolean {
  return attemptLine(record) && record.patch_phase !== "review" && record.patch_phase !== "shrink";
}

function isReviewAttempt(record: TelemetryRecord): boolean {
  return attemptLine(record) && record.patch_phase === "review";
}

function recordMatchesMode(record: TelemetryRecord, mode: TelemetrySummaryMode): boolean {
  if (mode === "patch") {
    return record.mode !== "plan" && record.mode !== "prompt";
  }
  if (mode === "prompt") {
    return record.mode === "prompt";
  }
  return record.mode === "plan";
}

function dominantSource(sources: Set<string>): string {
  if (sources.has("agent")) {
    return "agent";
  }
  if (sources.has("computed")) {
    return "computed";
  }
  if (sources.has("estimated")) {
    return "estimated";
  }
  if (sources.has("no-price")) {
    return "no-price";
  }
  return "unavailable";
}

function rowCountLabel(n: number, noun: "iteration" | "attempt"): string {
  return `${n} ${noun}(s)`;
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
  if (
    record.usage_source !== ("agent" satisfies UsageSource) &&
    record.usage_source !== ("estimated" satisfies UsageSource)
  ) {
    return null;
  }
  const n = normalizeSource(record.cost_source);
  // "estimated" intentionally excluded: estimated and computed/agent are
  // expected to coexist for cursor across model switches; don't flag as mixed.
  if (n === "agent" || n === "computed" || n === "no-price") {
    return n;
  }
  return null;
}

function newAggregate(cli: string): AgentAggregate {
  return {
    cliName: cli,
    configuredModels: new Set<string>(),
    completedOkInvocations: 0,
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
    estimatedCount: 0,
    costSourcesAll: new Set<string>(),
    meaningfulCostSources: new Set<string>(),
  };
}

function hasMeaningfulUsage(usage: TelemetryUsage | undefined): boolean {
  if (usage === undefined) {
    return false;
  }
  return (
    toNumber(usage.input_tokens) +
      toNumber(usage.output_tokens) +
      toNumber(usage.cache_read_input_tokens) +
      toNumber(usage.cache_creation_input_tokens) >
    0
  );
}

function loadFilteredRecords(args: {
  telemetryPath: string | null;
  namespace: string;
  startTs: string;
  mode: TelemetrySummaryMode;
}): TelemetryRecord[] {
  if (args.telemetryPath === null || !existsSync(args.telemetryPath)) {
    return [];
  }
  const raw = readFileSync(args.telemetryPath, "utf8");
  const runRecords: TelemetryRecord[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as TelemetryRecord;
      if (parsed.namespace !== args.namespace || parsed.ts < args.startTs || !recordMatchesMode(parsed, args.mode)) {
        continue;
      }
      runRecords.push(parsed);
    } catch {
      // Ignore malformed lines.
    }
  }
  return runRecords;
}

type RenderLabels = {
  title: string;
  rowCountNoun: "iteration" | "attempt";
  noteUnitNoun: "iteration" | "attempt";
};

function renderSummaryFromRecords(args: {
  runRecords: TelemetryRecord[];
  exitReason: string;
  durationMs: number;
  specPath?: string;
  labels: RenderLabels;
  /** Patch-only: implementation iterations completed (harness counter).*/
  patchIterations?: number;
  /** When true, emit `phase attempts:` instead of pairing iterations + attempts.*/
  planStyleHeaders?: boolean;
  /** Runbook section to cite after the exit-reason line; omit to suppress.*/
  runbookSection?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`─── ${args.labels.title} ───`);
  if (args.specPath !== undefined) {
    lines.push(`spec: ${args.specPath}`);
  }
  lines.push(`exit reason: ${args.exitReason}`);

  if (args.runbookSection) {
    lines.push(`see runbook: OPERATOR_RUNBOOK.md › ${args.runbookSection}`);
  }

  const invocationAttempts = args.runRecords.filter(attemptLine).length;
  const implementationAttempts = args.runRecords.filter(isImplementationAttempt).length;
  const reviewAttempts = args.runRecords.filter(isReviewAttempt).length;

  if (args.planStyleHeaders === true) {
    lines.push(`phase attempts: ${invocationAttempts}`);
  } else if (args.patchIterations !== undefined) {
    lines.push(`iterations: ${args.patchIterations}`);
  }

  if (args.planStyleHeaders !== true) {
    lines.push(`attempts: ${implementationAttempts}`);
    if (reviewAttempts > 0) {
      lines.push(`review attempts: ${reviewAttempts}`);
    }
  }

  lines.push(`duration: ${formatDuration(args.durationMs)}`);
  lines.push("");

  if (args.runRecords.length === 0) {
    lines.push("(no telemetry records found for this run)");
    lines.push("");
    lines.push(`Hit a harness gap? ${INTAKE_SUGGESTION_URL}`);
    return `${lines.join("\n")}\n`;
  }

  const quotaExcludedByAgent = new Map<string, number>();
  const errorWithoutUsageByAgent = new Map<string, number>();
  const zeroAgentOutputByAgent = new Map<string, number>();

  for (const record of args.runRecords) {
    if (record.kind === "quota") {
      const cli = record.agent;
      quotaExcludedByAgent.set(cli, (quotaExcludedByAgent.get(cli) ?? 0) + 1);
    }
    if (
      record.kind === "error" &&
      record.agent !== "harness" &&
      record.record_role !== "run_terminal" &&
      !hasMeaningfulUsage(record.usage) &&
      record.usage_source !== "agent"
    ) {
      errorWithoutUsageByAgent.set(record.agent, (errorWithoutUsageByAgent.get(record.agent) ?? 0) + 1);
    }
    if (record.zero_agent_output === true && record.agent !== "harness") {
      const cli = record.agent;
      zeroAgentOutputByAgent.set(cli, (zeroAgentOutputByAgent.get(cli) ?? 0) + 1);
    }
  }

  const perAgent = new Map<string, AgentAggregate>();

  for (const record of args.runRecords) {
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

    aggregate.completedOkInvocations += 1;
    aggregate.inputTokens += toNumber(record.usage?.input_tokens);
    aggregate.outputTokens += toNumber(record.usage?.output_tokens);
    aggregate.cacheReadTokens += toNumber(record.usage?.cache_read_input_tokens);
    aggregate.cacheWriteTokens += toNumber(record.usage?.cache_creation_input_tokens);

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
      (record.usage_source === ("agent" satisfies UsageSource) ||
        record.usage_source === ("estimated" satisfies UsageSource)) &&
      record.cost_source === ("no-price" satisfies CostSource)
    ) {
      aggregate.noPriceCount += 1;
    }
    if (record.usage_source === ("estimated" satisfies UsageSource)) {
      aggregate.estimatedCount += 1;
    }
    if (record.warnings !== undefined && record.warnings.length > 0) {
      aggregate.parseWarningCount += 1;
    }
  }

  const rows = [...perAgent.values()].sort((a, b) => a.cliName.localeCompare(b.cliName));

  const showCacheColumns = rows.length > 0 && rows.some((row) => row.cacheReadTokens > 0 || row.cacheWriteTokens > 0);

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
        `${formatAgentColumn(row.cliName, row.configuredModels)} (${rowCountLabel(row.completedOkInvocations, args.labels.rowCountNoun)})`,
        formatInt(row.inputTokens),
        formatInt(row.outputTokens),
        ...(showCacheColumns ? [formatInt(row.cacheReadTokens), formatInt(row.cacheWriteTokens)] : []),
        formatMoney(row.knownCostCount > 0 ? row.knownCostUsd : null),
        dominantSource(row.costSourcesAll),
      ]);
    }

    const totalInput = rows.reduce((sum, row) => sum + row.inputTokens, 0);
    const totalOutput = rows.reduce((sum, row) => sum + row.outputTokens, 0);
    const totalCacheRead = rows.reduce((sum, row) => sum + row.cacheReadTokens, 0);
    const totalCacheWrite = rows.reduce((sum, row) => sum + row.cacheWriteTokens, 0);
    const totalKnownCost = rows.reduce((sum, row) => sum + row.knownCostUsd, 0);
    const totalKnownCostCount = rows.reduce((sum, row) => sum + row.knownCostCount, 0);

    table.push([
      "total",
      formatInt(totalInput),
      formatInt(totalOutput),
      ...(showCacheColumns ? [formatInt(totalCacheRead), formatInt(totalCacheWrite)] : []),
      formatMoney(totalKnownCostCount > 0 ? totalKnownCost : null),
      "",
    ]);

    const headerRow = table[0];
    if (headerRow !== undefined) {
      const widths = headerRow.map((_, col) => Math.max(...table.map((row) => row[col]?.length ?? 0)));
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
    lines.push(
      args.planStyleHeaders === true
        ? "(plan cost totals aggregate successful agent attempts only.)"
        : "(patch cost totals aggregate completed iterations only.)",
    );
  }

  const notes: string[] = [];

  const quotaAgents = [...quotaExcludedByAgent.keys()].sort((a, b) => a.localeCompare(b));
  for (const qa of quotaAgents) {
    const n = quotaExcludedByAgent.get(qa) ?? 0;
    if (n > 0) {
      notes.push(`${n} quota attempt(s) under ${qa} were excluded from usage totals.`);
    }
  }

  const errAgents = [...errorWithoutUsageByAgent.keys()].sort((a, b) => a.localeCompare(b));
  for (const ea of errAgents) {
    const n = errorWithoutUsageByAgent.get(ea) ?? 0;
    if (n > 0) {
      notes.push(`${n} failed agent attempt(s) under ${ea} recorded no usage (excluded from usage totals).`);
    }
  }

  const nu = args.labels.noteUnitNoun;

  const zeroOutputAgents = [...zeroAgentOutputByAgent.keys()].sort((a, b) => a.localeCompare(b));
  for (const za of zeroOutputAgents) {
    const n = zeroAgentOutputByAgent.get(za) ?? 0;
    if (n > 0) {
      notes.push(
        `${n} ${nu}(s) under ${za} produced zero observed output (stdout + stderr); check agent binding and environment.`,
      );
    }
  }
  for (const row of rows) {
    if (row.unavailableUsageCount > 0) {
      notes.push(
        `${row.unavailableUsageCount} ${nu}(s) under ${row.cliName} had no usage data (usage_source=unavailable).`,
      );
    }
    if (row.noPriceCount > 0) {
      notes.push(
        `${row.noPriceCount} ${nu}(s) under ${row.cliName} had usage data but no price-table entry for the model.`,
      );
    }
    if (row.parseWarningCount > 0) {
      notes.push(`${row.parseWarningCount} ${nu}(s) under ${row.cliName} recorded parse warnings.`);
    }
    if (row.meaningfulCostSources.size > 1) {
      notes.push(`${row.cliName} mixes cost sources: ${[...row.meaningfulCostSources].sort().join(", ")}.`);
    }
  }

  const totalNullCostCount = rows.reduce((sum, row) => sum + row.nullCostCount, 0);
  if (totalNullCostCount > 0) {
    notes.push(`${totalNullCostCount} ${nu}(s) had null cost and were excluded from total cost.`);
  }

  if (rows.some((row) => row.estimatedCount > 0)) {
    notes.push(
      "cursor cost is estimated from prompt + stdout token counts; actual cursor usage (tool calls, sub-turns) is not measurable from the CLI.",
    );
  }

  if (notes.length > 0) {
    lines.push("");
    lines.push("notes:");
    for (const note of notes) {
      lines.push(`  - ${note}`);
    }
  }

  lines.push("");
  lines.push(`Hit a harness gap? ${INTAKE_SUGGESTION_URL}`);
  return `${lines.join("\n")}\n`;
}

export function runSummary(args: RunSummaryArgs): string {
  const unsuffixedReason = args.exitReason.split(" (exit code")[0] ?? args.exitReason;
  const runbookSection = mapExitReasonToRunbookSection(unsuffixedReason);

  if (args.telemetryPath === null || !existsSync(args.telemetryPath)) {
    const lines = ["─── run summary ───", `spec: ${args.specPath}`, `exit reason: ${args.exitReason}`];
    if (runbookSection !== null) {
      lines.push(`see runbook: OPERATOR_RUNBOOK.md › ${runbookSection}`);
    }
    lines.push(
      `iterations: ${args.iterations}`,
      "attempts: 0",
      `duration: ${formatDuration(args.durationMs)}`,
      "",
      "(no telemetry records found for this run)",
      "",
      `Hit a harness gap? ${INTAKE_SUGGESTION_URL}`,
    );
    return lines.join("\n");
  }

  const runRecords = loadFilteredRecords({
    telemetryPath: args.telemetryPath,
    namespace: args.namespace,
    startTs: args.startTs,
    mode: "patch",
  });

  return renderSummaryFromRecords({
    runRecords,
    exitReason: args.exitReason,
    durationMs: args.durationMs,
    specPath: args.specPath,
    labels: {
      title: "run summary",
      rowCountNoun: "iteration",
      noteUnitNoun: "iteration",
    },
    patchIterations: args.iterations,
    planStyleHeaders: false,
    runbookSection,
  });
}

/** Plan-mode usage summary: shared aggregation as patch, plan-specific headers/labels.*/
export function planSummary(args: PlanSummaryArgs): string {
  if (args.telemetryPath === null || !existsSync(args.telemetryPath)) {
    const lines = [
      "─── plan summary ───",
      `spec: ${args.specPath}`,
      `exit reason: ${args.exitReason}`,
      "phase attempts: 0",
      `duration: ${formatDuration(args.durationMs)}`,
      "",
      "(no telemetry records found for this run)",
      "",
      `Hit a harness gap? ${INTAKE_SUGGESTION_URL}`,
    ];
    return lines.join("\n");
  }

  const runRecords = loadFilteredRecords({
    telemetryPath: args.telemetryPath,
    namespace: args.namespace,
    startTs: args.startTs,
    mode: "plan",
  });

  return renderSummaryFromRecords({
    runRecords,
    exitReason: args.exitReason,
    durationMs: args.durationMs,
    specPath: args.specPath,
    labels: {
      title: "plan summary",
      rowCountNoun: "attempt",
      noteUnitNoun: "attempt",
    },
    planStyleHeaders: true,
  });
}

/** Prompt-mode usage summary: single-pass with attempt labels and no spec path.*/
export function promptSummary(args: PromptSummaryArgs): string {
  if (args.telemetryPath === null || !existsSync(args.telemetryPath)) {
    const lines = [
      "─── prompt summary ───",
      `exit reason: ${args.exitReason}`,
      `duration: ${formatDuration(args.durationMs)}`,
      "",
      "(no telemetry records found for this run)",
      "",
      `Hit a harness gap? ${INTAKE_SUGGESTION_URL}`,
    ];
    return lines.join("\n");
  }

  const runRecords = loadFilteredRecords({
    telemetryPath: args.telemetryPath,
    namespace: args.namespace,
    startTs: args.startTs,
    mode: "prompt",
  });

  return renderSummaryFromRecords({
    runRecords,
    exitReason: args.exitReason,
    durationMs: args.durationMs,
    labels: {
      title: "prompt summary",
      rowCountNoun: "attempt",
      noteUnitNoun: "attempt",
    },
  });
}
