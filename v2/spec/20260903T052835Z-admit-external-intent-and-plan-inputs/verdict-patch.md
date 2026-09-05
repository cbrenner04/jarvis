Verifying key claims against the spec and docs before issuing the verdict.
## Verdict

**Required before close**

1. **`v2/docs/workflow-runner.md` — external implement admission predicate.** The implement section still claims admission uses “the same predicate `planSource` uses.” After subspec `02`, `planSource` uses `effectivePublishGit` (project `plan.commit`, then machine `modes.plan.commit`, then `true`); implement admission still uses project-only `git === false` or `plan.commit === false`. Subspec `02` intentionally preserved that split; the doc must state the implement predicate separately and must not equate it to `planSource`.

2. **`v2/src/execution/implement-workflow-steps.ts` — stale comment on `planSourcePublishesExternally`.** The “Matches `planSource` external publication” comment is now false for the same reason. Update it to describe the project-only implement predicate (or note the intentional divergence from intent/plan).

3. **`v2/docs/operator-runbook.md` — incomplete effective-publication wording.** “Where planning artifacts live” lists only `projects.<key>.git: false` and `projects.<key>.plan.commit: false`, omitting machine `modes.plan.commit: false` even though intent/plan now honor it and `install-and-config.md` documents the full precedence. Align the runbook with the authoritative effective-publication formula (brief mention or explicit cross-link without duplicating the table).

4. **`v2/spec/.../intent.md` — stale parent acceptance checkboxes.** All subspecs `00`–`05` and `index.md` are closed; parent `intent.md` acceptance criteria remain unchecked. Tick them for traceability — implementation and verification already satisfy the parent contract.

**No required actuator changes**

- Core behavior for external seed/ready-intent admission, commit-decision parity, regression tests, and subspec `03`–`05` docs meet landed acceptance.
- `plan.commit: false`-only happy-path admission tests, symlink/cross-project negative tests, `publishCompletion: git` doc note, IO error-message polish, and `git`→`publishGit` rename are valid hardening/nits, not spec failures.
- Machine-only `modes.plan.commit: false` leaving implement on the project-only predicate is spec-intentional; `v1-behaviors.md` already records the split. No implement predicate change required — only correct the false “same predicate” claims above.