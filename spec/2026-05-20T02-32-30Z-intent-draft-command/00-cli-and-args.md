# 00 - CLI registration and arg parsing

Add `intent` as a recognized subcommand and parse its flags into a typed `IntentInvocation`.

## Context

`src/cli.ts` holds the `Subcommand` union, the `ParsedArgs` discriminated union, `parseArgs()`, and the `run()` dispatcher. `src/commands/plan-args.ts` is the template: it exports a `PlanInvocation` type (discriminated by `mode`) and a `parsePlanArgs()` function that returns a `PlanParseResult`.

The `intent` command shares the same three input modes as `plan` (`file`, `inline`, `interactive`) but drops all plan-specific flags (`--refine-turns`, `--review-passes`, `--repo`, `--resume`). It adds `--out <path>` and retains `--cwd <path>`.

## Task checklist

- [ ] Create `src/commands/intent-args.ts`
  - Export `IntentInvocation` discriminated union:
    - Common fields: `cwd: string`, `out: string` (resolved absolute output path, defaults to `join(cwd, "intent.md")`)
    - `{ mode: "file"; intentPath: string }` — positional arg is an existing file path
    - `{ mode: "inline"; intentText: string }` — positional arg is a quoted string (not a file path)
    - `{ mode: "interactive" }` — no positional arg
  - Export `IntentParseResult = { ok: true; invocation: IntentInvocation } | { ok: false; exitCode: number; message: string }`
  - Export `parseIntentArgs(args: readonly string[], cwd: string): IntentParseResult`
    - Parse `--out <path>` (resolves relative to `cwd`; absolute paths used as-is)
    - Parse `--cwd <path>` (overrides the passed-in `cwd`)
    - If positional arg looks like an existing file path → `mode: "file"`
    - If positional arg is present but not a file → `mode: "inline"`
    - If no positional arg → `mode: "interactive"`
    - Return `{ ok: false }` with a message for unknown flags or missing `--out` value

- [ ] Add `"intent"` to the `Subcommand` union in `src/cli.ts`

- [ ] Add `{ kind: "intent"; rest: string[] }` to the `ParsedArgs` union in `src/cli.ts`

- [ ] Add `case "intent"` to `parseArgs()` in `src/cli.ts` — returns `{ kind: "intent", rest: remaining }` following the `plan` case exactly

- [ ] Add `case "intent"` to `run()` in `src/cli.ts` — dispatches to `intentCommand({ io, args: parsed.rest, cwd: opts.cwd, config: opts.config })` following the `plan` case exactly

- [ ] Add a one-line entry for `intent` to the USAGE string in `src/cli.ts`

## Acceptance criteria

- [ ] `parseIntentArgs([], "/repo")` returns `{ ok: true, invocation: { mode: "interactive", cwd: "/repo", out: "/repo/intent.md" } }`
- [ ] `parseIntentArgs(["--out", "notes.md"], "/repo")` returns `out: "/repo/notes.md"`
- [ ] `parseIntentArgs(["/absolute/path/to/seed.md"], "/repo")` with the file existing returns `mode: "file"` and `intentPath: "/absolute/path/to/seed.md"`
- [ ] `parseIntentArgs(["some intent text"], "/repo")` with no matching file returns `mode: "inline"` and `intentText: "some intent text"`
- [ ] `parseIntentArgs(["--unknown"], "/repo")` returns `{ ok: false }`
- [ ] `jarvis intent --help` (or unknown subcommand path) shows the USAGE entry for `intent`
- [ ] TypeScript compiles without errors (`tsc --noEmit` passes)
