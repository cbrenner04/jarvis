# Failed publication consumers use failed rows

Remove the obsolete `completed`-row publication-failure compatibility path for `completion_commit_failed` and `ready_flip_failed` now that writers and migration `032-completed-publication-failure-rows-to-failed` guarantee `failed` rows. `ready_gate_failed` on completed rows is out of scope and unchanged.

## Subspecs

- [ ] [00 — Incident derivation keys on failed publication rows](00-incident-derivation-failed-publication-rows.md)
- [ ] [01 — Operator error and list/wait projection ignore stale publication causes on completed rows](01-operator-error-and-projection-failed-publication-rows.md)
- [ ] [02 — Pipeline stage recovery and dispatch stay on failed publication rows](02-stage-recovery-and-dispatch-failed-publication-rows.md)
