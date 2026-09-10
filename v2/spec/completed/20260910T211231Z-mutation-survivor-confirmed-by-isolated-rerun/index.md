# Confirm a surviving mutation with an isolated re-run before reporting it

Diff-derived mutation verification reports `surviving-mutation` after one execution of the resolved killing set; a contended pass produced a false survivor on a guard the killing test does kill, stranding a lane. Require a second, isolated clean pass before reporting.

- [ ] [00-confirm-survivor-with-isolated-rerun.md](./00-confirm-survivor-with-isolated-rerun.md)
