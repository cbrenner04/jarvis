# 02 — Input modes (file, inline, no-args) parsing

## Problem

`jarvis plan` supports three input modes:

1. **File**: `jarvis plan path/to/intent.md` — an existing file path.
2. **Inline**: `jarvis plan "free-form text here"` — an arbitrary string.
3. **Interactive**: `jarvis plan` (no positional argument).

The only way to disambiguate file from inline is to test whether the
positional argument resolves to an existing file. This subspec lands the
parser that classifies the invocation into one of those three modes, plus
parsing of the flags advertised in subspec 01. No mode-specific behavior
runs yet — each branch ends in the same stub exit.

## Decisions

- **Classification rule.** With exactly one positional argument:
  - If the argument exists as a regular file on disk (resolved relative to
    the current working directory or `--cwd`), classify as **file mode**.
  - Otherwise classify as **inline mode**. Strings that happen to look
    like paths but do not resolve to files are treated as inline text;
    this matches Unix conventions and avoids surprising "I meant a file
    but you took it as text" failures (the file-not-found case in inline
    mode is the user's text, which is fine).
  - If the user wants to force inline mode for a string that happens to
    name an existing file, they can prefix it with whitespace or wrap it
    in quotes that the shell preserves. We do not add `--inline` /
    `--file` flags in this skeleton; we will revisit if real usage shows
    the heuristic biting people.
- **Zero positional arguments** classifies as **interactive mode**.
- **Two or more positional arguments** is a usage error: print
  `jarvis plan: too many arguments` to stderr and exit `1`. Multi-word
  inline intents must be quoted.
- **Flags parsed and stored on the `PlanInvocation` shape:**
  - `--interview-turns <n>` — non-negative integer, optional. Default left
    `undefined` here; defaults are applied at consumption time in a later
    spec.
  - `--review-passes <n>` — non-negative integer, optional. Same handling.
  - `--repo <name|path|url>` — string, optional. Consumed by subspec 03.
  - `--cwd <dir>` — string, optional. Resolved at parse time relative to
    the process CWD; the resulting absolute path is stored on
    `PlanInvocation.cwd`.
  - `--resume` — boolean flag. Stored but not yet acted on (resume
    behavior lands in `spec/plan-mode-resume-and-handoff/`).
- **Invalid flag values** (negative number, non-integer for `-turns` /
  `-passes`, missing required value) exit `1` with a precise error
  message; never `2`.
- **Stub exit unchanged.** After parsing, every classified mode falls
  through to the same stub message and exit code `2`. The classified
  invocation is logged to stderr (one line, e.g. `plan mode: file
  intent=spec/plan-mode/intent-draft.md`) so testers can confirm parsing
  worked without grepping internals.

## Implementation hints

- Define `PlanInvocation` as a discriminated union on
  `mode: "file" | "inline" | "interactive"` with shared fields
  (`interviewTurns?`, `reviewPasses?`, `repo?`, `cwd`, `resume`) and a
  mode-specific payload (`intentPath` for file, `intentText` for inline,
  none for interactive).
- Keep the parser pure: takes `argv: string[]` plus `processCwd: string`,
  returns `{ ok: true, invocation } | { ok: false, exitCode, message }`.
  The command function then dispatches.

## Tasks

- [ ] Add `PlanInvocation` type to `src/commands/plan.ts` (or a sibling
  `plan-args.ts` if it grows).
- [ ] Implement the parser with the rules above.
- [ ] Replace the subspec-01 stub body with: parse → on parse failure,
  print error to stderr and exit with the parser's exit code; on success,
  log the classified invocation to stderr and exit `2` with the stub
  message.
- [ ] Tests covering each classification:
  - No args → interactive mode, exits `2`.
  - One arg that is an existing file → file mode, exits `2`, intent path
    captured.
  - One arg that is not a file → inline mode, exits `2`, intent text
    captured.
  - Two positional args → usage error, exits `1`.
  - Each flag parsed correctly; invalid values rejected with exit `1`.
  - `--resume` accepted (parsed but inert).
  - `--cwd` rewrites how the file-existence check is performed.

## Acceptance criteria

- [ ] All three input modes are classified by the parser per the rules
  above and reach the stub exit (`2`).
- [ ] Bad flag values (`--interview-turns -1`, `--review-passes foo`,
  trailing `--repo` with no value) exit `1` with a specific error.
- [ ] Two or more positional arguments exit `1` with `too many
  arguments`.
- [ ] No worktree, file, branch, commit, or PR is created or modified by
  any invocation.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 06 covers README and docs.
