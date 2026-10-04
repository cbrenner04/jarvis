# Cursor binding delivers prompt on stdin with bounded argv

## Problem

`runCursorBinding` passes the full prompt as the last argv token while `stdio[0]` is `ignore`, so large review-debate prompts hit `posix_spawn` `E2BIG` (production path in `src/shared/invocation/agents.ts` `buildArgv`; operator gotcha in `docs/operator-runbook.md`). Claude and codex already pipe prompts in the same `singleSpawn` helper.

## Decision ledger

- Cursor prompt delivery is stdin via `cursor agent -p` with no trailing prompt positional and `stdio: ["pipe", "pipe", "pipe"]` plus `writeStdin`, matching claude/codex; rules out keeping the prompt as argv tail or truncating the diff.
- Plan probe (2026-10-04): `printf 'Reply with exactly: PROBE_OK' | cursor agent -p --output-format text --trust --force --workspace <empty-dir>` returned `PROBE_OK` with no positional prompt; implement re-runs the same probe before coding and only then may switch to a temp-file path referenced by bounded argv (single path token, never prompt bytes in argv); rules out implementing temp-file first without a failed re-probe.
- Deferred to first consumer: exact temp-file argv flag/shape if stdin re-probe fails — pin when a caller needs it.
- Opencode stays argv-last positional for this spec; update `docs/shared-invocation.md` to state that explicitly; rules out opencode stdin migration here.
- `CURSOR_DEFAULT_ARGV` / unrestricted-policy expectations drop the prompt literal from argv and assert stdin carries the probe prompt in binding shape tests; rules out leaving `CURSOR_DEFAULT_ARGV` ending with `"p"`.

## Task checklist

- Re-run the plan stdin probe; if it fails, implement temp-file delivery per ledger escape hatch and document the pinned argv in this subspec's ledger before continuing.
- Change `runCursorBinding` `buildArgv` to omit prompt text from argv; enable stdin pipe and `writeStdin` like claude/codex.
- Update `agents.test.ts` cursor CLI-shape and `CURSOR_DEFAULT_ARGV` expectations; add multi-megabyte prompt regression test.
- Align `docs/shared-invocation.md`, `docs/v1-behaviors.md` (harness divergence bullet for cursor argv→stdin), and remove the review-debate `E2BIG` gotcha from `docs/operator-runbook.md`.

## Acceptance criteria

- [x] `agents.test.ts` test `cursor binding spawns with bounded argv and delivers a multi-megabyte prompt on stdin` fails against pre-fix code (prompt still in argv, stdin empty) and passes after the change.
- [x] `agents.test.ts` test `default and explicit unrestricted policy yield today's argv for claude, codex, and cursor` reflects the bounded cursor argv (no prompt literal) while claude and codex `argv` stay byte-identical aside from any shared test harness path changes.
- [x] `agents.test.ts` test `claude binding invokes the CLI shape with cwd and stdin prompt` stays green.
- [x] `agents.test.ts` test `codex binding invokes the CLI shape with cwd, stdin prompt marker, and abort signal` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:agent` passes.

## Documentation updates

- [ ] `docs/shared-invocation.md` — cursor prompt on stdin (opencode still argv-last; note if temp-file fallback was pinned).
- [ ] `docs/v1-behaviors.md` — harness divergence bullet for cursor prompt delivery argv→stdin.
- [ ] `docs/operator-runbook.md` — remove the review-debate `E2BIG` workaround once stdin delivery lands.
