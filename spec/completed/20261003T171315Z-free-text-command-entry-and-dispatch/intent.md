---
name: free-text-command-entry-and-dispatch
---

# A one-shot free-text request dispatches through the same admission as the explicit command

## Problem

`jarvis "create a pipeline for v2/spec/path/to/seed.md"` has no entry point in `v2/src/cli.ts`; the operator must remember command grammar. This is one command invocation, not a conversation or autonomous planner.

## Decisions

- The entry invokes the routing role, validates its output against the catalog, resolves projects, paths, IDs, and preconditions deterministically, then dispatches through the canonical operation the explicit CLI uses (e.g. `pipeline-start-admission.ts`); the model cannot invent config overrides, bypass approval gates, or supply pipeline definitions.
- Ambiguous, unsupported, incomplete, or invalid requests return an error and perform no action: no clarification session, guessed meaning, recovery sequence, multi-action execution, or invented aliases (no `restart` for `resume`).
- Malformed explicit commands stay errors; they never fall through to the router. The operation's actual result is returned without a second model interpretation.
- Plan must decide the entry grammar: the quoted form is supported; whether unquoted arguments are joined, and the explicit entry form for collisions with command names.
- Plan must decide the execution audit record and duplicate-request handling after a transport failure.

## Prerequisites

- Validated typed actions (delivered by: routing-action-catalog-and-validation)
- Tool-free routing invocation (delivered by: routing-agent-role-and-tool-free-invocation)
- Canonical lifecycle and admission operations the dispatcher reuses (delivered by: shared-git-operations-boundary)

## Acceptance criteria

- [ ] `free-text-routing.test.ts`: a supported pipeline-start sentence reaches the same admission service and yields the same result as the explicit command; fails against current code (no entry).
- [ ] Same file: ambiguity, missing or invalid targets, unsupported actions, schema violations, attempted tool execution, and model failure each return an error with no daemon mutation.
- [ ] `cli.test.ts` or `command-tree` tests: a malformed explicit command errors deterministically without invoking the router.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — invocation syntax, supported actions, ambiguity errors, shell quoting and expansion limits.
- `v2/docs/v1-behaviors.md` — record free-text routing as additive.

## Primary implementation surface

- `v2/src/commands/free-text-routing.ts` (new)
- `v2/src/cli.ts`, `v2/src/cli/command-tree.ts`
