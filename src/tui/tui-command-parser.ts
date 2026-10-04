import { parseArgs } from "node:util";
import { PIPELINE_START_PARSE_ARG_OPTIONS } from "../cli/command-help-flags.ts";

export type TuiSeed = { mode: "path"; value: string } | { mode: "text"; value: string };

export type TuiCommand =
  | { kind: "start"; project: string; seed: TuiSeed; risk?: string; effort?: string }
  | { kind: "expand" }
  | { kind: "collapse" }
  | { kind: "approve" }
  | { kind: "reject" }
  | { kind: "resume" }
  | { kind: "kill" }
  | { kind: "resume-run" }
  | { kind: "log" };

export type TuiCommandErrorCode =
  | "malformed_input"
  | "unterminated_quote"
  | "unknown_verb"
  | "missing_project"
  | "missing_seed_choice"
  | "missing_seed_value"
  | "both_seed_flags"
  | "duplicate_seed_flag"
  | "missing_option_value"
  | "unknown_option"
  | "extra_positional"
  | "unexpected_arguments";

export type TuiCommandError = { kind: "error"; code: TuiCommandErrorCode };

export type TuiCommandParseResult = TuiCommand | TuiCommandError;

export type TuiTokenizeResult = { kind: "tokens"; tokens: string[] } | { kind: "error"; code: "unterminated_quote" };

const BARE_VERBS = new Set(["expand", "collapse"]);

export function tokenizeTuiCommand(input: string): TuiTokenizeResult {
  const tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quoted = false;
  let escaping = false;

  for (const character of input) {
    if (escaping) {
      if (/\s/u.test(character) || character === '"' || character === "\\") {
        token += character;
      } else {
        token += `\\${character}`;
      }
      tokenStarted = true;
      escaping = false;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      tokenStarted = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      tokenStarted = true;
      continue;
    }
    if (/\s/u.test(character) && !quoted) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    token += character;
    tokenStarted = true;
  }

  if (quoted) return { kind: "error", code: "unterminated_quote" };
  if (escaping === true) token += "\\";
  if (tokenStarted === true) tokens.push(token);
  return { kind: "tokens", tokens };
}

function error(code: TuiCommandErrorCode): TuiCommandError {
  return { kind: "error", code };
}

/** `parseArgs` options for the dock's `pipeline start`: the CLI's, with the seed flags collected so a repeat is an error rather than last-wins. */
const START_PARSE_ARG_OPTIONS = {
  ...PIPELINE_START_PARSE_ARG_OPTIONS,
  seed: { type: "string", multiple: true },
  "seed-text": { type: "string", multiple: true },
} as const;

type StartParse = ReturnType<typeof parseArgs<{ options: typeof START_PARSE_ARG_OPTIONS; allowPositionals: true }>>;

/** Maps a strict `parseArgs` rejection to a dock code: unknown flag, or a string flag without a value (seed flags keep their named code). */
function startParseErrorCode(thrown: unknown): TuiCommandErrorCode {
  const { code, message } = (thrown ?? {}) as { code?: unknown; message?: unknown };
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") return "unknown_option";
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" && typeof message === "string") {
    if (/'--seed(?:-text)?/.test(message)) return "missing_seed_value";
    if (/does not take an argument/.test(message)) return "unknown_option";
    return "missing_option_value";
  }
  return "malformed_input";
}

/** Parses the tokens after `pipeline start` with the CLI's own `parseArgs` options, so flag placement and `--flag=value` match `jarvis pipeline start`. */
function parsePipelineStartBody(tokens: readonly string[]): TuiCommandParseResult {
  let parsed: StartParse;
  try {
    parsed = parseArgs({ args: [...tokens], allowPositionals: true, strict: true, options: START_PARSE_ARG_OPTIONS });
  } catch (thrown) {
    return error(startParseErrorCode(thrown));
  }
  const { positionals, values } = parsed;
  const project = positionals[0];
  if (project === undefined) return error("missing_project");
  if (positionals.length > 1) return error("extra_positional");

  const pathSeeds = values.seed ?? [];
  const textSeeds = values["seed-text"] ?? [];
  if (pathSeeds.length > 1 || textSeeds.length > 1) return error("duplicate_seed_flag");
  if (pathSeeds.length === 1 && textSeeds.length === 1) return error("both_seed_flags");
  const seed: TuiSeed | undefined =
    pathSeeds[0] !== undefined
      ? { mode: "path", value: pathSeeds[0] }
      : textSeeds[0] !== undefined
        ? { mode: "text", value: textSeeds[0] }
        : undefined;
  if (seed === undefined) return error("missing_seed_choice");
  return {
    kind: "start",
    project,
    seed,
    ...(values.risk !== undefined ? { risk: values.risk } : {}),
    ...(values.effort !== undefined ? { effort: values.effort } : {}),
  };
}

type SelectionKind = Exclude<TuiCommand["kind"], "start" | "expand" | "collapse">;

/** `<verb> <sub>` → selection-scoped command kind; `pipeline start` is the one sub that takes a body. */
const SUBCOMMANDS: Readonly<Record<"pipeline" | "run", Readonly<Record<string, SelectionKind>>>> = {
  pipeline: { approve: "approve", reject: "reject", resume: "resume" },
  run: { kill: "kill", resume: "resume-run", log: "log" },
};

function parseSubcommand(verb: keyof typeof SUBCOMMANDS, tokens: readonly string[]): TuiCommandParseResult {
  const sub = tokens[1];
  if (sub === undefined) return error("unknown_verb");
  if (verb === "pipeline" && sub === "start") return parsePipelineStartBody(tokens.slice(2));
  const kind = Object.hasOwn(SUBCOMMANDS[verb], sub) ? SUBCOMMANDS[verb][sub] : undefined;
  if (kind === undefined) return error("unknown_verb");
  if (tokens.length > 2) return error("unexpected_arguments");
  return { kind };
}

export function parseTuiCommand(input: string): TuiCommandParseResult {
  const tokenized = tokenizeTuiCommand(input);
  if (tokenized.kind === "error") return tokenized;
  const { tokens } = tokenized;
  if (tokens.length === 0) return error("malformed_input");

  const verb = tokens[0] as string;
  if (BARE_VERBS.has(verb)) {
    if (tokens.length > 1) return error("unexpected_arguments");
    return { kind: verb as "expand" | "collapse" };
  }
  if (verb === "pipeline" || verb === "run") return parseSubcommand(verb, tokens);
  return error("unknown_verb");
}
