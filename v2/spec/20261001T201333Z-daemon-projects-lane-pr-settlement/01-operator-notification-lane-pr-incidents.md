# Operator notification lane PR incidents

## Problem

`deriveOperatorIncidents` and sink discharge still emit `publication-failure` or generic terminal incidents for runs and pipeline stages that settled on `lane_pr_closed` or `lane_pr_merged`, so `notificationSinkCommand` consumers never see the lane outcome or PR number Jarvis already recorded.

## Decisions

- Run- and stage-derived incidents that correspond to a durable `lane_pr_closed` or `lane_pr_merged` settlement include the lane outcome kind and PR number on the sink JSON (reuse `OperatorIncident` fields where they already exist, e.g. `cause`/`detail`/`prNumber`/`prUrl`, rather than a parallel schema) — rules out `publication-failure` / free-form publication copy when settlement already named the lane outcome.
- Lane-outcome incidents use a transition shape that distinguishes each settlement (`lane_pr_closed` / `lane_pr_merged` plus PR number in the transition string or payload); bump `NOTIFICATION_KEY_FORMAT_VERSION` when transition strings change — rules out re-sending under stale keys after a format bump.
- Settlement writes stay in the sibling spec; this subspec only adjusts `operator-incidents.ts` derivation and tests — rules out re-implementing `lanePrOutcome` persistence here.

## Tasks

- [ ] Extend `deriveOperatorIncidents` (and preview key helpers) for terminal runs and lane-settled pipeline stages so incidents name the outcome and PR number instead of publication-failure-only transitions.
- [ ] Add `operator-notification.test.ts` regressions for run-terminal and stage-boundary lane outcomes; assert serialized sink JSON via `serializeOperatorIncident` (same path persistence uses).
- [ ] Bump or test `NOTIFICATION_KEY_FORMAT_VERSION` / `reconcileNotificationKeyFormat` when lane transition strings change.
- [ ] No `daemon-host.md` / `v1-behaviors.md` edits here; subspec 02 owns doc closure for this spec.

## Acceptance criteria

- [ ] `operator-notification.test.ts`: a run settled `lane_pr_closed` emits an incident whose `cause` or `transition` names `lane_pr_closed`, with `prNumber` on the in-memory incident; fails against pre-fix `publication-failure` derivation.
- [ ] `operator-notification.test.ts`: a run settled `lane_pr_merged` emits an incident naming `lane_pr_merged` and `prNumber`; fails against pre-fix projections that omit merged outcome kind.
- [ ] `operator-notification.test.ts`: a pipeline stage row with `artifact.lanePrOutcome` crossing `stage-succeeded` (or terminal stage boundary) emits a lane-outcome incident with `prNumber`; fails against pre-fix stage incidents that omit lane outcome kind.
- [ ] `operator-notification.test.ts`: `JSON.parse(serializeOperatorIncident(incident))` for lane-outcome incidents includes `prNumber` and includes `prUrl` when the durable run or stage artifact carried a URL; fails against pre-fix serialization that omits those fields.
- [ ] `operator-notification.test.ts`: when lane transition strings change, `NOTIFICATION_KEY_FORMAT_VERSION` is bumped and reconcile behavior prevents duplicate discharge under the old key format; fails against pre-fix version/key mismatch.

## Documentation updates

- None in this subspec (notification sink lane fields land in subspec 02).
