---
name: mutation-checkpoint-parser-requires-directive-token-first
---

# Mutation-checkpoint parser must not misread prose mentions of the directive token as directives

## Problem

`parseMutateDirectives` in `v2/src/execution/mutation-checkpoint-verifier.ts` decides whether a comment line is a directive with `COMMENT_DIRECTIVE_LINE = /^\s*\/\/.*@mutate/`, which matches the `@mutate` token *anywhere* in a `//` comment. `DIRECTIVE_PATTERN` (`shared/mutation-checkpoint-criteria.ts`) is likewise unanchored. So a prose comment that merely *mentions* the directive token — e.g. `// Keystone checkpoint: an in-body \`// @mutate\` directive disables ...` — passes the gate, fails full directive parsing, and is reported as an unparseable/malformed checkpoint. That fails the write-loop's artifact contract with `contract_miss`, stranding the whole run.

Observed 2026-08-10: this blocked `tui-work-idle-time` after subspecs 00/01 completed (the run had modified `tui-monitor-lines.test.ts`, whose segment-rows prose comments mention the token) and would identically block `tui-attention-row-act-in-place` (touches `tui-ink-monitor.test.tsx`). The run is non-resumable, so the spec strands. Tactical unblock (PR #2793) reworded the prose; this seed is the durable parser fix so future prose mentions are harmless.

## Decisions

- A comment line is a directive only when the `@mutate` token appears immediately after the comment slashes (optional whitespace): `// @mutate ...`. A `//` comment that mentions the token later in prose is not a directive and produces no unparseable/malformed report — rules out treating any `@mutate` substring in a comment as a directive.
- A genuine directive with a malformed body (token in directive position but wrong `path "orig" -> "repl"` form) still reports `malformed` — rules out weakening real syntax validation into silence.
- Scope to directive-line recognition; no change to how a recognized directive's target/original/replacement is verified, nor to enclosing-test linkage — rules out reworking the verifier or linker.

## Acceptance criteria

- [ ] `parseMutateDirectives` returns zero directives and zero unparseable entries for a `//` comment that mentions the directive token later in prose (a "Keystone checkpoint:" comment referencing the token); a new `v2/src/execution/mutation-checkpoint-verifier.test.ts` regression pins this and fails against the current match-token-anywhere gate.
- [ ] A well-formed `// @mutate <path> "<orig>" -> "<repl>"` line still parses to one directive; a regression pins it.
- [ ] A line whose directive-position token is present but whose body is malformed still reports `malformed`; a regression pins the negative case.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — record that prose mentions of the directive token no longer strand runs, and remove any standing "reword prose @mutate mentions" workaround note once this lands.
