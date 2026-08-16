---
name: tui-dock-command-grammar-mirrors-cli
---

# The tui dock grammar diverges from the CLI; operators expect the shell command minus `jarvis`

## Problem

`jarvis tui`'s dock verbs are a bespoke set (`start`, `approve`, `reject`, `resume`, `kill`, `pause`, `resume-run`, `expand`, `collapse`, `log`) that does not match the CLI grammar operators already know (`pipeline start`, `pipeline approve`, `pipeline reject`, `pipeline resume`, `run kill`, `run pause`, `run resume`, `run log`). Observed 2026-08-16: the operator drove the dock like a shell and typed the CLI form (`pipeline start …`), which parsed as `unknown_verb` and silently did nothing they noticed. Their mental model — "same command structure as the CLI, just without `jarvis` in front" — is the intuitive one, and the current grammar violates it. The command-center brief deferred grammar changes as a Non-goal pending exactly this dogfooding.

The friction is worst where the dock name is unguessable from the CLI: `start` (vs `pipeline start`), `resume-run` (vs `run resume`), and the bare selection-scoped `approve`/`kill`/`log` (vs `pipeline approve <id> <stage> <branch>` / `run kill <id>` / `run log <id>`).

## Decisions

- Align dock verbs to the CLI subcommand path minus the `jarvis` prefix: `pipeline start`, `pipeline approve`, `pipeline reject`, `pipeline resume`, `run kill`, `run pause`, `run resume`, `run log`. Rules out the divergent bespoke names.
- Selection-scoped shorthand still matters in the TUI (act on the highlighted row without retyping an id), so decide how the CLI grammar and selection coexist — e.g. accept the full CLI form with explicit id args *and* an id-omitted form that targets the current selection. This is the core design question for the intent/plan step; do not pre-decide the exact arg-optionality rules here.
- `expand`/`collapse` have no CLI analogue (they are pure view state); keep them as-is or namespace them (`view expand`?) — a smaller sub-decision, not the crux.
- Preserve every current safety property: at-most-one in-flight admission, parse-error/selection-error feedback on `lastCommandResult`, and buffer retention on failure. Grammar realignment is a parser/verb-naming change, not a steering-semantics change.
- Keep old verb names as accepted aliases for at least one iteration, or hard-cut — an explicit decision for the plan (single-operator repo, so churn tolerance is high but muscle memory is real).

## Open questions (resolve in intent/plan, not here)

- Full-id-required vs selection-default vs both, per verb.
- Whether to alias or hard-cut the old names.
- Whether `expand`/`collapse`/Enter-reveal get a CLI-style namespace or stay bare.
- `--detach` handling: the dock `start` is inherently detached (the TUI never blocks on completion), yet the CLI `pipeline start` carries `--detach`. Under CLI-aligned grammar the dock should accept-and-ignore `--detach` for parity rather than reject it as `unknown_option` (today's behavior). Relatedly, an operator flagged `--detach` as an odd flag for pipelines at all — a separate CLI-ergonomics question (detach-by-default with an explicit `--wait`?) tracked outside this seed.

## Acceptance criteria

- [ ] Typing the CLI form minus `jarvis` for each steering verb (`pipeline start …`, `pipeline approve …`, `run kill …`, `run log …`, etc.) dispatches the same action the current bespoke verb does, pinned by parser tests.
- [ ] The chosen selection-vs-explicit-id rule is pinned by tests for at least one pipeline verb and one run verb.
- [ ] Parse-error, selection-error, and buffer-retention behavior is unchanged for the realigned grammar, pinned by tests.
- [ ] `v2/docs/operator-runbook.md`'s Dock commands table reflects the realigned grammar.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — rewrite the Dock commands table to the CLI-aligned grammar, documenting the selection-vs-explicit-id rule and any retained aliases.
