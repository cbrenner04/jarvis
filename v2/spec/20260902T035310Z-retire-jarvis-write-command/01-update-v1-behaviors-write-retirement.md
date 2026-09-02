# Catalog write-command retirement in v1-behaviors

## Problem

`v2/docs/v1-behaviors.md` still documents foreground `jarvis write` under `### v2 write (jarvis write)` and references it from `jarvis run wait` exit-code mapping. After subspec 00, that top-level command no longer exists; the catalog must record the retirement without a full doc sweep.

## Behavior

Add a minimal `v1-behaviors.md` entry that the `jarvis write` top-level command is removed; `jarvis run start` and workflow write steps remain the supported admission paths. Retire the foreground-write bullet (line 574) under `### v2 write (jarvis write)`. Relocate the review/idle execution bullets (lines 575–578) under an execution/workflow-appropriate heading without the retired CLI label. Rewrite the `jarvis run wait` exit-code bullet (line 579) to compare against `run start`/loop-outcome semantics instead of `jarvis write`. Remove `write` from the help-tree flag-example list (line 45).

## Decision ledger

- Minimal catalog note only in this spec; rules out sweeping `v2/docs/`, `README.md`, and operator runbooks here (owned by `align-docs-after-write-retirement`).
- Retire line 574 and relocate 575–578 by behavior, not by deleting the whole section; rules out dropping review/idle bullets with the CLI heading.
- Record retirement under the existing completion/exit-codes section rather than inventing a new doc home; rules out a standalone CLI-retirement doc file.
- Fix the line 45 help-tree `write` example in this slice; rules out deferring a catalog entry that still lists `write` as a live help node.

## Tasks

- Edit `v2/docs/v1-behaviors.md`: note top-level `jarvis write` removal and that `run start` plus workflow write steps remain; delete or rewrite the line 574 foreground-write bullet; move lines 575–578 under a heading that describes review/idle execution (not `jarvis write`); rewrite line 579 so `run wait` exit codes compare to loop-outcome/`run start` semantics, not live `jarvis write`; remove `write` from the line 45 flag-example list.

## Acceptance criteria

- [ ] `v2/docs/v1-behaviors.md` records that the `jarvis write` top-level command is removed and that `jarvis run start` plus workflow write steps remain the supported write-admission paths; fails against the pre-fix catalog that still documents foreground `jarvis write`.
- [ ] `v2/docs/v1-behaviors.md` `jarvis run wait` exit-code bullet no longer cites `jarvis write` as a live comparator; fails against line 579 on the pre-fix catalog.
- [ ] `v2/docs/v1-behaviors.md` help-tree flag-example list no longer includes `write` as a live node; fails against line 45 on the pre-fix catalog.

## Documentation updates

- `v2/docs/v1-behaviors.md` — minimal retirement note; comprehensive catalog sweep deferred to `align-docs-after-write-retirement`.
