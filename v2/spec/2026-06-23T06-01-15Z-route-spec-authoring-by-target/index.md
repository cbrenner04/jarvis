# Route spec authoring by target

repo: cbrenner04/jarvis

Author seeds and specs in their target-version home from the start: v1 work under `v1/spec/`, genuine v2 planning under `v2/spec/`, both-surfaces → v1 wins. `jarvis plan` already has a validated `--target-dir` override; this adds the same to `jarvis intent` so the exception tree is reachable per run, then reconciles the conventions.

Operator rollout (not in repo, not an AC): flip the jarvis project's live `plan.targetDir` from `v2/spec` to `v1/spec` via `jarvis config` once these land.

- [ ] [00 - intent --target-dir override](./00-intent-target-dir-override.md)
- [ ] [01 - reconcile route-by-target conventions](./01-reconcile-route-by-target-conventions.md)
