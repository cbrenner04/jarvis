# 00 - Recover a timed-out subspec

## Decisions

- Recovery requires an explicit operator-directed plan action, rather than rewriting a spec from timeout history during patch or ordinary plan resume.
- One recorded terminal per-iteration timeout makes a linked subspec eligible, rather than requiring the existing three-timeout blocker.
- Recovery replaces the selected index entry with two or more independently testable subspecs, rather than leaving the operator to edit and renumber the tree.
- Recovery preserves valid index links and linked-subspec references, rather than retaining stale pointers to the replaced subspec.
- Recovery command syntax and timeout-history presentation are deferred to the first consumer; pin when a caller needs them.
- `iterationTimeoutMs` remains unchanged, rather than treating recovery as timeout tuning.
- `v2/docs/v1-behaviors.md` is the canonical recovery-semantics record; `v1/docs/plan-mode.md` documents operator invocation and links to it, rather than duplicating lifecycle rules.
- Remove the manual subspec-split stopgap from `v1/docs/operator-runbook.md`, rather than maintaining a competing branch-and-PR recovery workflow.

## Task checklist

- Add an explicit plan recovery path that selects an eligible linked subspec from an existing spec tree.
- Use recorded terminal iteration-timeout evidence to reject ineligible recovery targets.
- Have the recovery path replace the selected subspec with smaller independently testable subspecs and reconcile affected index links and subspec references.
- Cover eligibility, explicit invocation, replacement-tree validity, and unchanged ordinary resume behavior.
- Update the required durable docs.

## Acceptance criteria

- [ ] An operator can explicitly invoke plan recovery for a linked subspec with one recorded terminal per-iteration timeout; ordinary patch runs and ordinary `jarvis1 plan --resume` do not rewrite timed-out subspecs.
- [ ] Recovery rejects a selected linked subspec that lacks recorded terminal per-iteration timeout evidence.
- [ ] Recovery replaces the selected linked subspec with two or more smaller independently testable subspecs, leaving a valid index whose links and affected subspec cross-references resolve without stale references to the replaced task.
- [ ] Automated coverage proves explicit recovery, one-timeout eligibility, ineligible-target rejection, replacement-tree reconciliation, and unchanged ordinary plan-resume behavior.
- [ ] `v1/docs/plan-mode.md` documents operator-directed timed-out-subspec recovery and links to the canonical semantics in `v2/docs/v1-behaviors.md`; the catalog records the behavior; `v1/docs/operator-runbook.md` no longer recommends manual subspec-split surgery.

## Documentation updates

- Update `v1/docs/plan-mode.md`.
- Update `v2/docs/v1-behaviors.md`.
- Remove the manual subspec-split stopgap from `v1/docs/operator-runbook.md`.
