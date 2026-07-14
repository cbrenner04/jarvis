# Agents tick acceptance criteria on untested behavior

Two implementation runs this session landed **new runtime behavior with zero tests**, every
acceptance criterion ticked, and a green gate. The criteria were satisfiable by reading the code;
nothing required evidence that the behavior actually changed.

## Problem

Observed 2026-07-13:

- The `no-done-without-a-completion-commit` run ticked all **5** criteria and added **0** tests.
  The operator added the test afterward — and it exposed that one ticked criterion
  (*"`completionCommitError` names the leftover paths"*) was **not actually satisfied** on the
  path the run had ticked it for.
- The `reconcile-done-token-against-unticked-criteria` run ticked all **6** criteria and added
  **0** tests for the new contract.

Contrast: the `blocked-run-retains-worktree-and-branch` spec carried the criterion *"a regression
test … that **fails against the pre-fix code**"* — and that criterion is what caught its own
seed's diagnosis being wrong. The agent wrote the test, found it passed on unmodified `HEAD`, and
blocked instead of inventing a fix. **The AC wording did that**, not the agent.

This is the completion-without-evidence pattern one level up: the harness now checks that
criteria are *ticked* (#1511), but a ticked criterion is only as good as what it demands.

## Decisions

- **A subspec that changes runtime behavior carries an acceptance criterion naming a test that
  fails against the pre-fix code and passes after.** Rules out "existing tests stay green" as the
  only test-shaped criterion — it is satisfied by changing nothing.
- The requirement lives in the **plan** prompt / spec guidance, so it applies to every spec the
  planner drafts, rather than depending on the implementing agent's judgment.
- Docs-only and spec-only subspecs are exempt.

## Prerequisites

- None.

## Out of scope

- Enforcing coverage mechanically (a diff-coverage gate) — a bigger, separate change. This seed
  is about what the spec *asks for*.

## Documentation updates

- `v1/docs/spec-guidance.md` § Acceptance criteria — state the failing-test requirement and show
  the `blocked-run` spec's criterion as the model.
