# CLI entry grammar and explicit-command fence

## Problem

`v2/src/cli.ts` dispatches only registered top-level command names; natural-language argv never reaches a router, and nothing prevents a malformed `jarvis pipeline …` from being mistaken for free-text.

## Decisions

- Top-level argv classifies before dispatch: if `argv[0]` matches a registered command name (`findCommand`), the explicit handler runs unchanged — rules out free-text when the first token is `pipeline`, `run`, `daemon`, etc.
- Otherwise, if `argv[0] === "request"`, the free-text body is `argv.slice(1).join(" ")` after trimming; an empty body errors — rules out using only a quoted first token for multi-word collision cases.
- Otherwise, when `argv.length === 1`, that sole token is the free-text body (shell-quoted `jarvis "start a pipeline for …"`); when `argv.length > 1` and `argv[0]` is not a command, join all tokens with single spaces into one body — rules out treating only `argv[0]` as the request or requiring a `request` prefix for the common quoted form.
- Free-text entry accepts no jarvis flags other than help aliases resolved the same way as today (`--help` / `-h` on the `request` path only when `resolveHelpFlagAlias` applies to `["request", …]`); other flags on a free-text argv are errors — rules out silently ignoring unknown `-` tokens.
- `command-tree.ts` gains a `request` node documenting usage (`jarvis request <text…>` and quoted one-argument form in runbook, not duplicated usage strings in two homes).
- Malformed explicit commands stay on the explicit path: e.g. `jarvis pipeline start` with missing seed flags must fail inside `runPipelineCommand` without calling `runFreeTextRouting` — rules out argv fall-through to the router when the first token is a known command.

## Tasks

- Wire `main` to call `runFreeTextRouting` for classified free-text argv after help/version handling; pass `operatorSessionId`, `Io`, and `CliDeps`.
- Extend `cli.test.ts` (or `command-tree` tests if only help text) with a spy/injected `runFreeTextRouting` proving `["pipeline", "start"]` never invokes it while `["request", "start", "a", "pipeline"]` does.
- Document invocation grammar, supported catalog actions, ambiguity errors, and shell quoting/expansion limits in `v2/docs/operator-runbook.md`.
- Add a **[v2 additive]** behavior bullet for free-text routing in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `cli.test.ts`: `jarvis pipeline start` (missing required seed flags) exits non-zero and does not invoke `runFreeTextRouting` under injection; fails against current code (no free-text branch).
- [x] Same file: `jarvis request create a pipeline for v2/spec/seeds/x.md` (or equivalent joined argv) invokes `runFreeTextRouting` exactly once with the joined body; fails against current code.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — free-text invocation (`request`, quoted single argument, joined unquoted tokens), supported actions, error semantics, shell quoting/expansion.
- `v2/docs/v1-behaviors.md` — additive free-text routing entry.
