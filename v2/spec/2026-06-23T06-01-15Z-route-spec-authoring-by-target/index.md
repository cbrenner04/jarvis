# Route spec authoring by target

repo: cbrenner04/jarvis

Author seeds and specs in their target-version home from the start: v1 work under `v1/spec/`, genuine v2 planning under `v2/spec/`, both-surfaces → v1 wins. `jarvis plan` already has a validated `--target-dir` override; this adds the same to `jarvis intent` so the exception tree is reachable per run, then reconciles the conventions.

Operator rollout (not in repo, not an AC): the live `plan.targetDir` is `v2/spec` today, so the conventions in subspec 01 are honest-but-pending until flipped. Flip it to `v1/spec` via `jarvis config` immediately on merge so the merged docs do not assert config that is not yet true.

- [x] [00 - intent --target-dir override](./00-intent-target-dir-override.md)
- [x] [01 - reconcile route-by-target conventions](./01-reconcile-route-by-target-conventions.md)
