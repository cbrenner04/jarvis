# 00 - CLI registration and arg parsing

Add `intent` as a recognized subcommand and parse its flags into a typed `IntentInvocation`.

## Context

`src/cli.ts` holds the `Subcommand` union, the `ParsedArgs` discriminated union, `parseArgs()`, and the `run()` dispatcher. `src/commands/plan-args.ts` is the template: it exports a `PlanInvocation` type (discriminated by `mode`) and a `parsePlanArgs()` function that returns a `PlanParseResult`.

The `intent` command shares the same three input modes as `plan` (`file`, `inline`, `interactive`) but drops all plan-specific flags (`--refine-turns`, `--review-passes`, `--repo`, `--resume`). It adds `--out <path>` and retains `--cwd <path>`.

This subspec only covers CLI surface registration and deterministic argument parsing. It does not cover agent invocation, overwrite checks, config loading, or prompt construction.

## Decisions

- `parseIntentArgs()` resolves `--cwd` before resolving `--out`, file inputs, or the default `intent.md` location.
- Relative file paths and relative `--out` values are interpreted against the effective `cwd` after applying `--cwd`.
- The parser accepts at most one positional argument. A second positional argument returns `{ ok: false, exitCode: 1, message: ... }`.
- A positional argument is `mode: "file"` only when the resolved path exists and is a file. If the resolved path exists and is a directory, return `{ ok: false }` with a named error instead of silently treating it as inline text.
- `src/cli.ts` owns the top-level help surface today, so this subspec only adds the `intent` usage line there and routes raw `rest` args to `intentCommand()`.

## Task checklist

- [ ] Create `src/commands/intent-args.ts`
  - Export `IntentInvocation` discriminated union:
    - Common fields: `cwd: string`, `out: string` (resolved absolute output path, defaults to `join(cwd, "intent.md")`)
    - `{ mode: "file"; intentPath: string }` — positional arg is an existing file path
    - `{ mode: "inline"; intentText: string }` — positional arg is a quoted string (not a file path)
    - `{ mode: "interactive" }` — no positional arg
  - Export `IntentParseResult = { ok: true; invocation: IntentInvocation } | { ok: false; exitCode: number; message: string }`
  - Export `parseIntentArgs(args: readonly string[], cwd: string): IntentParseResult`
    - Parse `--cwd <path>` first so later relative paths resolve against the overridden directory
    - Parse `--out <path>` after `--cwd` resolution (relative to the effective `cwd`; absolute paths used as-is)
    - Reject a second positional argument
    - If positional arg resolves to an existing file path → `mode: "file"`
    - If positional arg resolves to an existing directory path → return `{ ok: false }`
    - If positional arg is present but not a file → `mode: "inline"`
    - If no positional arg → `mode: "interactive"`
    - Return `{ ok: false }` with a message for unknown flags, missing `--out` value, missing `--cwd` value, or invalid directory seed paths

- [ ] Add `"intent"` to the `Subcommand` union in `src/cli.ts`

- [ ] Add `{ kind: "intent"; rest: string[] }` to the `ParsedArgs` union in `src/cli.ts`

- [ ] Add `case "intent"` to `parseArgs()` in `src/cli.ts` — returns `{ kind: "intent", rest: remaining }` following the `plan` case exactly

- [ ] Add `case "intent"` to `run()` in `src/cli.ts` — dispatches to `intentCommand({ io, args: parsed.rest, cwd: opts.cwd, config: opts.config })` following the `plan` case exactly

- [ ] Add a one-line entry for `intent` to the USAGE string in `src/cli.ts`

## Documentation updates

- [ ] Update the CLI usage/help text in `src/cli.ts` so `intent` appears alongside the existing top-level commands, including `--cwd`, `--out`, and the default `intent.md` destination.

## Acceptance criteria

- [ ] `parseIntentArgs([], "/repo")` returns `{ ok: true, invocation: { mode: "interactive", cwd: "/repo", out: "/repo/intent.md" } }`
- [ ] `parseIntentArgs(["--out", "notes.md"], "/repo")` returns `out: "/repo/notes.md"`
- [ ] `parseIntentArgs(["--cwd", "subdir", "--out", "notes.md"], "/repo")` resolves to `cwd: "/repo/subdir"` and `out: "/repo/subdir/notes.md"`
- [ ] `parseIntentArgs(["--cwd", "/tmp/specs", "./seed.md"], "/repo")` resolves the file candidate against `/tmp/specs`, not `/repo`
- [ ] `parseIntentArgs(["/absolute/path/to/seed.md"], "/repo")` with the file existing returns `mode: "file"` and `intentPath: "/absolute/path/to/seed.md"`
- [ ] `parseIntentArgs(["./seed.md"], "/repo")` with `/repo/seed.md` existing returns `mode: "file"` and `intentPath: "/repo/seed.md"`
- [ ] `parseIntentArgs(["some intent text"], "/repo")` with no matching file returns `mode: "inline"` and `intentText: "some intent text"`
- [ ] `parseIntentArgs(["existing-dir"], "/repo")` with `/repo/existing-dir` present as a directory returns `{ ok: false, exitCode: 1, message: "intent: seed path is a directory: /repo/existing-dir" }`
- [ ] `parseIntentArgs(["first", "second"], "/repo")` returns `{ ok: false }`
- [ ] `parseIntentArgs(["--unknown"], "/repo")` returns `{ ok: false }`
- [ ] `parseIntentArgs(["--out"], "/repo")` and `parseIntentArgs(["--cwd"], "/repo")` each return `{ ok: false }`
- [ ] `src/cli.ts` recognizes `intent` as a valid subcommand, routes its raw args to `intentCommand()`, and includes a one-line usage entry describing `--cwd`, `--out`, and the default `intent.md` target
- [ ] TypeScript compiles without errors (`tsc --noEmit` passes)
