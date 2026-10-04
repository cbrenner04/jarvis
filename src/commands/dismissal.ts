import type { Io } from "../cli/io.ts";

export type DismissalMode = "dismiss" | "undismiss";

/** Row-kind adapter: how the daemon's dismissal envelope names its id and state, and how the CLI confirms. */
export type DismissalRow<State extends string> = {
  kind: "run" | "pipeline";
  idField: "runId" | "pipelineId";
  stateField: "status" | "state";
  parseState: (value: string) => State | undefined;
  isTerminal: (state: State) => boolean;
  /** Candidates printed under a refusal reason; omitted for row kinds whose refusals name none. */
  refusalCandidates?: (reason: string, candidates: unknown) => string[];
  confirmation: (mode: DismissalMode, id: string) => string;
};

type DismissalOutcome<State extends string> =
  | { kind: "applied"; id: string; state: State }
  | { kind: "refused"; id: string; reason: string; candidates: string[] };

/** Single-id grammar shared by `run` and `pipeline` dismiss/undismiss: exactly one non-blank positional. */
export function parseDismissalArgs(argv: readonly string[]): { ok: true; id: string } | { ok: false } {
  if (argv.length !== 1) return { ok: false };
  const id = argv[0];
  if (id === undefined || id.trim().length === 0) return { ok: false };
  return { ok: true, id };
}

function parseDismissalOutcome<State extends string>(
  row: DismissalRow<State>,
  value: unknown,
): DismissalOutcome<State> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const id = record[row.idField];
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (record.kind === "applied") {
    const rawState = record[row.stateField];
    if (typeof rawState !== "string") return undefined;
    const state = row.parseState(rawState);
    if (state === undefined) return undefined;
    return { kind: "applied", id, state };
  }
  if (record.kind === "refused" && typeof record.reason === "string") {
    const candidates = row.refusalCandidates?.(record.reason, record.candidates) ?? [];
    return { kind: "refused", id, reason: record.reason, candidates };
  }
  return undefined;
}

/** Reports the daemon's dismissal envelope for `row`; returns the command exit code. */
export function reportDismissalOutcome<State extends string>(
  row: DismissalRow<State>,
  mode: DismissalMode,
  response: unknown,
  io: Io,
): number {
  const outcome = parseDismissalOutcome(row, response);
  if (outcome === undefined) {
    io.stderr("invalid daemon response\n");
    return 1;
  }
  if (outcome.kind === "refused") {
    io.stderr(`${outcome.reason}\n`);
    if (outcome.candidates.length > 0) io.stderr(`${outcome.candidates.join("\n")}\n`);
    return 1;
  }
  // Mutation checkpoint: neutering this guard to `if (false)` must drop the live-state warning,
  // turning the live-run-dismissal and live-pipeline-dismissal tests RED.
  if (mode === "dismiss" && !row.isTerminal(outcome.state)) {
    io.stderr(`${row.kind} dismiss: ${outcome.id} is ${outcome.state} and now hidden from listings\n`);
  }
  io.stdout(`${row.confirmation(mode, outcome.id)}\n`);
  return 0;
}
