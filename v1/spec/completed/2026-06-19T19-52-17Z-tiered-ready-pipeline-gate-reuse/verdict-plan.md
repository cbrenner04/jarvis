## Verdict: required refinements

### Intent alignment
- Qualify intent prose so **review-final unchanged path skips ready** (not `fast`), **intermediate reuse gates run `fast`**, and **“full before `gh pr ready`” applies only when tree changed or no recorded green**. Rules out implementers reading intent as requiring a second full run on the common path.

### Supersession
- State explicitly that this spec **supersedes** completed `01-gate-reuse` semantics: intermediate gates change from **skip** → **`fast` tier**; review-final changes from **unconditional full** → **skip on unchanged tree / `full` on changed**. Required so implementers and doc updates do not follow stale parity bullets.

### Subprocess tier contract (`00`)
- Pin **one harness→`scripts/ready.ts` tier transport** (env or argv, single owner in `00`; harness only sets it). Rules out per-gate ad-hoc wiring and matches existing `JARVIS_READY_*` precedent.
- Define **digest inputs** concretely enough to implement skip vs force-install (not lockfile-only). Rules out ambiguous “install-relevant state.”
- Add acceptance for **force-install**: absent `node_modules`, lockfile change, and lockfile-unchanged digest mismatch each run install.

### Harness tier matrix (`01`)
- Rewrite opening to separate **current problem** from **target behavior** (common path: one `full`, not two).
- Add decision explaining **asymmetric reuse**: intermediates run `fast` for cheap re-proof; review-final **skips** when predicate holds because completion already ran `full`. Rules out uniform skip or uniform `fast`.
- Cover **per-iteration `maybeMarkReady`** with the same `fast`/`full` policy as completion-transition (or one decision that both sites share one function/policy).
- Pin **`--resume-review` tier behavior** when no completion recorded-green exists (baseline + final matrix). Rules out silent inheritance from completion-path docs.
- Add acceptance rows for **no-review** (`maybeMarkReady` only) and **resume-review** (with/without carrier), not only the default review-enabled common path.
- State that **red completion / no recorded green** forces **`full` at every gate** that runs ready.

### Test and seam contracts (`01`)
- Decide how tests **observe tier** through `runReadyAndCommit` / `runReady` (signature or injectable seam). Acceptance requires tier matrix proof; current `(cwd) => void` seam cannot satisfy it without a recorded contract.
- Task coverage for **rewriting skip-based gate-reuse tests** to **`fast`-tier assertions** (shrink, baseline, `maybeMarkReady`) and **retiring unconditional review-final ready test** separately.
- Ensure **completion-transition gate** is in the tier test matrix (`full`).

### Documentation partition
- Partition durable doc edits to avoid duplicate/conflicting `run-loop.md` prose:
  - **`00`**: `bun run ready` = `full` tier; tier step definitions; install digest skip.
  - **`01`**: gate tier matrix; review-final reuse; supersession of prior skip/unconditional-final semantics; **exit-6** row update (intermediate `fast` does not commit `check:fix`; review-final skip relies on predicate cleanliness; dirty tree → `full` + commit path).
- **`01` owns `v1-behaviors.md` gate-tier bullet rewrites** (replace, not append). `00` does not leave parity catalog stale on install/tier definitions if `01` is the gate owner—partition must be explicit in both subspecs.

### Minor `00` clarity
- Reword “export tiered `runReady`” to reflect **subprocess-owned tier lists in `scripts/ready.ts`**, not a TS export the harness imports.

### Not required (upheld design)
- Duplicate **`test` runs on `fast`** at intermediate gates remain in scope; intent targets duplicate **full** pipeline, not zero test runs.
- Deferred on-disk digest marker path/format stays valid if tests assert skip/run behavior without pinning location.
