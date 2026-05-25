# Plan Defer-Precision Fragment

repo: cbrenner04/jarvis

The plan-mode refine/draft/review loop is a precision amplifier: append-only,
non-interactive, budget-driven. Pointed at a spec whose first consumer does not
exist yet, it manufactures invented precision (the v2 phase-1 state store pinned
duplicate-commit semantics, terminal encoding, and seven run statuses with no
caller). Give the loop the brake it lacks — a shared fragment that tells every
plan phase to defer decisions to the first consumer instead of guessing.

- [ ] [00 - plan.defer-to-consumer prompt fragment](./00-plan-defer-to-consumer-fragment.md)
