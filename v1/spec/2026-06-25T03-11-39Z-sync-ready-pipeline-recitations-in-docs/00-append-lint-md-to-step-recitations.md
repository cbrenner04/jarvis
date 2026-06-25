# Append `lint:md` to step-level ready recitations

## Behavior

Narrative docs (`README.md` and `v1/docs/*`) that enumerate the ready pipeline
at step level recite the current full tier ending at `lint:md`, matching the
enforced gate. The
`run-loop.md:125` ready-tier table is the source of truth and stays the single
canonical list; stale recitations are corrected in place, not re-homed.

## Decisions

- Mechanical per-doc edits, not a new shared canonical block — `run-loop.md`
  table already is the source of truth; a new linked list would add
  cross-reference churn for re-drift it doesn't prevent. (Rules out: extracting
  one canonical step list other docs link to.)
- Append only `lint:md` to enumerations that already end at `check`; do not
  rewrite earlier steps (`check:fix` vs `check:fix:unsafe` wording stays as each
  doc has it). (Rules out: normalizing every doc's full-tier prose.)
- Match each doc's existing separator: `→ lint:md` where the enumeration uses
  arrows, `bun run lint:md` appended to the comma list in `README.md`. (Rules
  out: forcing arrow syntax into prose comma lists.)
- Canonical source has its own `check:fix`/`check:fix:unsafe` inconsistency
  (`run-loop.md:125` reads `check:fix`; `v1-behaviors.md` and `run-loop.md:217`
  read `check:fix:unsafe`). Reconciling fixer wording is out of scope — this
  spec syncs only the `→ lint:md` tail.
- Leave abstracted `bun run ready` mentions with no step list untouched.

## Task checklist

- `v1/docs/plan-mode.md:373` — `…before typecheck → test → check proceeds` gains `→ lint:md`.
- `v1/docs/worktrees-and-commits.md:116` — `(typecheck → test → check)` gains `→ lint:md`.
- `v1/docs/workflows.md` mermaid nodes (~78, ~190) — `typecheck → test → check` gains `→ lint:md` **inside** the step sequence, before the node's closing `)`/`<br/>`; appending after the paren malforms the node.
- `v1/docs/workflows.md` prose (~231) — `typecheck → test → check` gains `→ lint:md`.
- `v1/docs/workflows.md` prose (~364) — `typecheck → test → check in CI order` gains `→ lint:md`.
- `README.md:464-466` — comma list `check:fix`, `typecheck`, `test`, and `check` gains `bun run lint:md` as the final item (comma prose, not arrows; leave `check:fix` wording as-is).

## Acceptance criteria

- [ ] No step-level ready-pipeline recitation in `v1/docs/plan-mode.md`, `v1/docs/worktrees-and-commits.md`, `v1/docs/workflows.md`, or `README.md` ends at `check`; each names `lint:md` as the final step.
- [ ] `v1/docs/run-loop.md` ready-tier table (line ~125) is unchanged.
- [ ] Abstracted `bun run ready` mentions that list no steps are unchanged.

## Documentation updates

This change is itself the documentation sync. `v2/docs/v1-behaviors.md` already
records the full `install → check:fix:unsafe → typecheck → test → check →
lint:md` sequence (no behavior change here), so it needs no update.
