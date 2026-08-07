export type TuiSeed = { mode: "path"; value: string } | { mode: "text"; value: string };

export type TuiCommand =
  | { kind: "start"; project: string; seed: TuiSeed }
  | { kind: "expand" }
  | { kind: "collapse" }
  | { kind: "approve" }
  | { kind: "reject" }
  | { kind: "resume" }
  | { kind: "kill" }
  | { kind: "pause" }
  | { kind: "resume-run" }
  | { kind: "log" };

export type TuiCommandErrorCode =
  | "malformed_input"
  | "unterminated_quote"
  | "unknown_verb"
  | "recognized_unavailable"
  | "missing_project"
  | "missing_seed_choice"
  | "missing_seed_value"
  | "both_seed_flags"
  | "duplicate_seed_flag"
  | "unknown_option"
  | "extra_positional"
  | "unexpected_arguments";

type PlainTuiCommandErrorCode = Exclude<TuiCommandErrorCode, "recognized_unavailable">;

export type TuiCommandError =
  | { kind: "error"; code: PlainTuiCommandErrorCode }
  | { kind: "error"; code: "recognized_unavailable"; command: string };

export type TuiCommandParseResult = TuiCommand | TuiCommandError;

export type TuiTokenizeResult = { kind: "tokens"; tokens: string[] } | { kind: "error"; code: "unterminated_quote" };

const ZERO_ARG_VERBS = new Set([
  "expand",
  "collapse",
  "approve",
  "reject",
  "resume",
  "kill",
  "pause",
  "resume-run",
  "log",
]);

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

function error(code: PlainTuiCommandErrorCode): TuiCommandError {
  return { kind: "error", code };
}

function parseStart(tokens: readonly string[]): TuiCommandParseResult {
  if (tokens.length < 2) return error("missing_project");

  const pathSeeds: string[] = [];
  const textSeeds: string[] = [];
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    switch (token) {
      case "--seed":
      case "--seed-text": {
        const value = tokens[index + 1];
        if (value === undefined || value.startsWith("-")) return error("missing_seed_value");
        (token === "--seed" ? pathSeeds : textSeeds).push(value);
        index += 1;
        break;
      }
      default:
        if (token.startsWith("-")) return error("unknown_option");
        return error("extra_positional");
    }
  }

  if (pathSeeds.length > 1 || textSeeds.length > 1) return error("duplicate_seed_flag");
  if (pathSeeds.length === 1 && textSeeds.length === 1) return error("both_seed_flags");
  if (pathSeeds.length === 0 && textSeeds.length === 0) return error("missing_seed_choice");
  if (pathSeeds[0] !== undefined) {
    return { kind: "start", project: tokens[1] as string, seed: { mode: "path", value: pathSeeds[0] } };
  }
  return {
    kind: "start",
    project: tokens[1] as string,
    seed: { mode: "text", value: textSeeds[0] as string },
  };
}

export function parseTuiCommand(input: string): TuiCommandParseResult {
  const tokenized = tokenizeTuiCommand(input);
  if (tokenized.kind === "error") return tokenized;
  const { tokens } = tokenized;
  if (tokens.length === 0) return error("malformed_input");

  const verb = tokens[0] as string;
  if (verb === "start") return parseStart(tokens);
  if (!ZERO_ARG_VERBS.has(verb)) return error("unknown_verb");
  if (tokens.length > 1) return error("unexpected_arguments");
  return {
    kind: verb as "expand" | "collapse" | "approve" | "reject" | "resume" | "kill" | "pause" | "resume-run" | "log",
  };
}
