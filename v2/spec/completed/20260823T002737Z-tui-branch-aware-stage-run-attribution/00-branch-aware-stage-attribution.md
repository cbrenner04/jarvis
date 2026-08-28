# A run on a stage's branch nests under that stage instead of doubling as an ad-hoc row

## Problem

A pipeline stage records exactly one `workflowInvocationId`. `buildStageNodes` joins runs to a stage by `run.workflow?.invocationId === invocationId`, and `isAdHocCandidate` calls a run ad-hoc unless its invocation id is in `collectMatchedInvocationIds(snapshots)` (`v2/src/tui/tui-monitor-pipeline-tree.ts`). A run that shares a stage's work under a *different* invocation id therefore escapes attribution entirely and paints as its own top-level ad-hoc row while the stage still shows its own attributed run — the same work painted twice, once with logs and once without.

Confirmed 2026-08-16 on a `full-review` pipeline: the `plan` stage recorded `1c65481a-…` (the real run, carrying the failure logs) while a top-level ad-hoc row on the *same branch* `plan/pipeline-list-human-readable` carried `f900c104-…` (no useful logs). Because the leak is a distinct invocation on the stage's branch rather than a successor step of the recorded one, no invocation-id-only rule can catch it.

The branch is already on the wire: `DaemonListRunRow.branch` is a required field on every non-queued row, alongside `project` (`v2/src/daemon/daemon-wire.ts`). The tree aggregates runs and pipelines across daemons/projects (`derivePipelineProject` exists precisely because that ambiguity is live), so the match key is the `(project, branch)` pair, not branch alone — a branch-only rule would attribute a same-named branch (`main`, or a shared slug) from one project into another project's stage subtree. `PipelineSnapshot.stages[].branchKey` is **not** the git branch — it is the fan-out key (`default` or an intent slug) — so both the project and the branch must be derived from the joined run rows, not the snapshot.

Attribution must also be keyed on the workflow invocation as a unit, not the individual run: collapsed table rows take their `members` from the full run list by invocation id (`buildWorkflowTableRows` / `partitionRunsByWorkflowInvocation` in `v2/src/tui/tui-monitor-workflow-collapse.ts`), not from whichever runs a per-run rule happened to match. If one run of a leaked invocation matches a stage's `(project, branch)` while a sibling run of that same invocation carries a different or blank branch, per-run attribution would nest the matching run under the stage while the full collapsed group — including that same matching run, by invocation membership — still paints again as a top-level ad-hoc row. That is the exact double-paint this subspec removes, reintroduced in a new shape. So the unit of attribution is the invocation: an invocation is claimed as a whole when *any* of its member runs matches a displayed stage's `(project, branch)`.

## Decision ledger

- The match key is `(project, branch)`, taken from `DaemonListRunRow.project` and `DaemonListRunRow.branch`; rules out matching branch alone, which collides across projects sharing a branch name.
- A stage's claim set is the distinct `(project, branch)` pairs of the runs joined to its recorded `workflowInvocationId`; rules out reading `stage.branchKey`, which is the fan-out key (`default` / intent slug), not a project or a git branch.
- Attribution claims a whole workflow invocation, not an individual run: an invocation with no recorded stage of its own is attributed to a stage when any one of its member runs (drawn from the full run list, the same membership `buildWorkflowTableRows` uses) matches that stage's `(project, branch)` claim set; every member of the claimed invocation then renders under that stage and none renders as, or inside, a top-level ad-hoc row. Rules out per-run attribution, which can nest one member under a stage while an unmatched sibling member of the same invocation still paints its whole collapsed group at the top level.
- A blank (empty or whitespace-only) branch never participates in a match on either side — neither as part of a stage's claim set nor as a run whose branch could satisfy one; rules out collapsing every branchless row onto one stage.
- An invocation-less run (no `workflow.invocationId`) is never branch-attributed; there is no invocation unit for it to be claimed as. Rules out swallowing a hand-launched invocation-less `jarvis run` row that happens to share a branch into a pipeline subtree.
- Claims are built only from **displayed** pipelines (`displayedSnapshots`, after the dismissed-pipeline filter), not the unfiltered `snapshots` argument. A claim names a stage node id that must actually render; `collectMatchedInvocationIds`'s unfiltered-`snapshots` scan is a *suppression* set (correct to keep a dismissed pipeline's own runs from resurfacing) and is not the same thing as a *claim* — a claim built from a hidden pipeline would suppress a run from the ad-hoc list while rendering it under no visible node, and could let a hidden stage outbid a displayed one via the tie-break below. Rules out reusing `collectMatchedInvocationIds`'s unfiltered scan for claim construction.
- Claim construction applies the same two elisions `buildStageNodes` applies before its own `claimInvocationId` dedup — a post-split placeholder stage (`isElidedPlaceholderStage`) and a decided/bypassed approval gate (`isElidedGateStage`) each contribute no claim — plus the same per-pipeline `claimInvocationId` dedup itself, so a stage that does not display its own invocation's runs claims nothing and a second same-invocation stage record claims nothing already claimed by the first. (Both elisions are inert today: only workflow dispatch/recovery ever writes `workflowInvocationId`, and neither a placeholder nor a gate stage does. The rule is stated so claim construction cannot silently diverge from `buildStageNodes` if that changes.)
- Matching is scoped to the pipelines and runs present in that single `buildMonitorPipelineTreeJoin` call — no cross-call history, no time window; rules out a pipeline absent from the current snapshot pass claiming a run by branch (already implied by the displayed-pipelines rule above, since an absent pipeline is never displayed).
- Among stages claiming the same `(project, branch)`, the greatest `startedAt` wins — an unstarted stage loses to any started one, and later listing order breaks equal starts. This substitutes `stage.startedAt` for the intent's "run start time": pipeline linkage always writes `workflowInvocationId` and `startedAt` together, so any claim-capable stage has a non-null `startedAt` in production; an all-null tie is a fixture-only shape, not a reachable production case. Rules out first-match-wins, which hands a resumed or concurrent pipeline's run to the stale earlier stage, and rules out attributing one invocation to several stages.
- Within a stage's rendered runs, its own recorded-invocation group renders before any branch-attributed group; rules out a branch-attributed group rendering above the stage's own recorded work.
- The stage node records its claimed run ids (`MonitorPipelineTreeStageNode.claimedRunIds`, required — the union of its recorded-invocation runs and every branch-attributed invocation's member runs) so `flattenMonitorPipelineTree` rebuilds the same run set when the stage expands; rules out recomputing from `workflowInvocationId` alone at flatten time, which drops the branch-attributed rows exactly when the operator expands the stage to look at them.
- Expanding a stage expands every invocation among its claimed runs; rules out expanding only the stage's recorded invocation, which leaves a branch-attributed group permanently collapsed.
- `attributedRuns` on pipeline and branch nodes (used for idle/last-activity timing) stays invocation-id-only; rules out widening it, which would fold a leaked invocation's `finishedAtMs` into pipeline idle/last-activity timing with no reported symptom behind the change.
- A stage's claim set is derived from its own currently-joined runs, which are subject to the daemon's `list` retention window; once every run backing a stage's claim ages out of retention, that stage's claim set (and any branch attribution it was making) empties and a same-branch leaked invocation repaints ad-hoc again. This is the honest answer to whether the model can always attribute by branch — it can, conditional on retention — rather than a gap this subspec papers over.
- Once a stage claims a `(project, branch)` pair, every retained, currently-unmatched invocation on that pair is swallowed into that stage for as long as both remain in the current `list`/`pipeline_list` snapshot pass — including a terminal ad-hoc invocation from earlier in the retention window that happens to share the pair. The daemon's `(project, branch)` registry-claim exclusivity bounds this among *live* runs only; it does not bound retained terminal rows. This is accepted as the cost of branch-aware attribution on a long-lived shared branch (for example `main`); it is not a regression this subspec is responsible for narrowing further.
- Existing pipeline-tree fixtures whose unattributed runs share the builder's default `project: "demo"` / `branch: "main"` with a joined stage run move onto a distinct `(project, branch)` pair; rules out weakening those assertions to accommodate the new rule.
- Why a duplicate invocation exists on one branch at all stays out of scope and is a possible separate daemon-side gap; the projection stops the doubling regardless.

## Task checklist

- Add the claim-collection and invocation-attribution helpers to `v2/src/tui/tui-monitor-pipeline-tree.ts` (see Implementer notes), computed once inside `buildMonitorPipelineTreeJoin` from `displayedSnapshots` and `builderRuns`.
- Thread the resulting invocation attribution map into `buildStageNodes` so a stage's table rows cover its own recorded-invocation runs, followed by every branch-attributed invocation's member runs, and record the full set as `claimedRunIds` on the stage node (`MonitorPipelineTreeStageNode` gains the required field).
- Rebuild `stageRunsForExpansion` off `stage.claimedRunIds`, expanding every invocation among them; drop the now-unused `pipeline` parameter from it and from `pushStageWithRuns`.
- Suppress branch-attributed invocations in `isAdHocCandidate` (an invocation-level check, not per-run).
- Update the two stage-node object literals in `v2/src/tui/tui-monitor-pipeline-tree.test.ts` (`pipeline and stage row helpers fill the full pane width`, `stage row elapsed is empty when startedAt is null`) with `claimedRunIds: []`, and move the orphan runs in `excludes stage-matched and queued runs from ad-hoc candidates` onto a `(project, branch)` pair distinct from the stage's.
- Add the tests below, with their in-body `// @mutate` directives, to `v2/src/tui/tui-monitor-pipeline-tree.test.ts`.
- Add one test to `v2/src/tui/tui-attention-rows.test.ts` pinning the attention-row label consequence described below (no production code change in that file).
- Update `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] One pipeline whose single stage records invocation `A` with a joined run on `(project "demo", branch "plan/x")`, plus a second run on that same pair carrying invocation `B` that no stage records: the `B` run is reachable under that stage and `adHocNodes` is empty. Fails against the pre-fix projection, which nests only the `A` run and paints `B` as a top-level ad-hoc row. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a run sharing a stage's branch under a different invocation nests under that stage and emits no ad-hoc row`; Keystone checkpoint: an in-body `// @mutate` directive replacing the claim-collection call in the invocation-attribution helper with an empty claim list restores baseline invocation-id-only attribution and turns this test red.
- [x] A stage's joined run and a leaked-invocation run share the same `branch` string but carry different `project` values: the leaked run stays a top-level ad-hoc row and nests under no stage. Fails against a branch-only match rule. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a same-branch run from a different project is not attributed and stays a top-level ad-hoc row`; Mutation checkpoint: an in-body `// @mutate` directive dropping `project` from the claim key (matching on `branch` alone) attributes the cross-project run and turns this test red.
- [x] A leaked invocation has two member runs, one on the stage's `(project, branch)` and one on a blank branch: both members render under the stage as one collapsed workflow group covering both run ids, and neither renders in `adHocNodes`. Fails against a per-run match rule, which would nest only the matching member and still paint the group — including that same member, by invocation membership — as a top-level ad-hoc row. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `an unmatched invocation is claimed as a unit even when only one of its member runs matches the stage's branch`; Mutation checkpoint: an in-body `// @mutate` directive narrowing invocation attribution back to a single matching run reproduces that double-paint and turns this test red.
- [x] Extends the existing dismissed-pipeline fixture so the dismissed pipeline's stage and a leaked invocation share a `(project, branch)` pair: the leaked run stays a top-level ad-hoc row — not attributed to the hidden pipeline's stage, and not silently dropped from both the tree and the ad-hoc list. Fails against claim construction built from unfiltered `snapshots`. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a claim from a dismissed pipeline's stage never attributes a run`; Mutation checkpoint: an in-body `// @mutate` directive building claims from `snapshots` instead of `displayedSnapshots` suppresses the leaked run from `adHocNodes` with no rendering node for it and turns this test red.
- [x] A stage's recorded invocation has entry/review/publication member runs and its branch also carries a distinct leaked invocation's own two member runs: every one of those five run ids is reachable under that stage as two collapsed workflow groups (none at the top level), and the stage's own recorded-invocation group renders before the leaked-invocation group. Fails against the pre-fix projection (only the recorded invocation's runs render under the stage) and against an unordered join. Pinned by `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a stage with entry, review, and publication runs also claims a same-branch leaked invocation, with its own runs first`.
- [x] A workflow run on a branch no listed stage owns still renders as a top-level ad-hoc row (no over-suppression). `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a workflow run on a branch no stage owns still renders as a top-level ad-hoc row`; Mutation checkpoint: an in-body `// @mutate` directive inverting the branch-attributed suppression in `isAdHocCandidate` suppresses this genuinely unattributed run and turns this test red.
- [x] A leaked invocation's only member run carries a blank branch and a listed stage's joined run also carries a blank branch: the leaked run stays a top-level ad-hoc row. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a blank branch never attributes a run to a stage`; Mutation checkpoint: an in-body `// @mutate` directive making the blank-branch helper return the untrimmed branch instead of `null` attributes the blank-branch run to the stage and turns this test red.
- [x] On a `(project, branch)` a listed stage owns, an invocation-less run still renders as a top-level standalone ad-hoc row. Pinned by `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a run carrying no workflow invocation is never branch-attributed`. This is a structural invariant of invocation-unit attribution (an invocation-less run has no invocation to be claimed as) rather than a separately invertible guard, so it carries no `// @mutate` directive.
- [x] Two currently-listed stages of different pipelines share a `(project, branch)` pair: a same-pair leaked invocation is claimed only by the later-started stage, appearing under that stage and under neither the earlier-started stage nor in any ad-hoc row. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a same-branch invocation attributes to the most recently started stage only`; Mutation checkpoint: an in-body `// @mutate` directive reducing the claim tie-break to first-match-wins hands the run to the earlier-started stage and turns this test red.
- [x] A flattened-tree regression test over `buildMonitorPipelineTree` (extending or added alongside the existing flatten coverage) asserts that with the pipeline and its stage expanded, no run id — counting collapsed-group members, not just row ids — appears both under the pipeline subtree and as a top-level node, using a branch-attributed-invocation fixture (from the keystone or unit-attribution cases above) as the reproduction case.
- [x] A flattened-tree test asserts expanding a stage that claims a branch-attributed invocation keeps that invocation's group present under the stage and materializes its non-representative members as their own rows, with the stage's own recorded-invocation group still ordered first.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `excludes stage-matched and queued runs from ad-hoc candidates` stays green with its orphan runs moved onto a `(project, branch)` pair distinct from the stage's.
- [x] `v2/src/tui/tui-attention-rows.test.ts` — a new test asserts that a run branch-attributed to a pipeline stage projects an attention row (when it also qualifies, e.g. `failed`) whose `where` is the pipeline's target label (`pipelineTargetLabel`: pipeline label plus `branchKey`), not the run's own git branch — the same attribution path `runIncidents` already applies to invocation-matched runs, now also reached by branch-attributed ones because `stage.runs`/`claimedRunIds` cover them.
- [x] `v2/docs/operator-runbook.md` — the Observe section records that a run whose `(project, branch)` matches a currently-listed pipeline stage's is attributed to that stage as a whole workflow invocation and never also paints as a top-level ad-hoc row; ad-hoc rows are only invocations matching no displayed stage of any pipeline; a run with a blank branch, no workflow invocation, or claimed only by a dismissed (hidden) pipeline's stage is never branch-attributed; when concurrent or resumed pipelines list stages on one `(project, branch)`, the most-recently-started stage claims the run; and a branch-attributed run's attention-row location reads as its pipeline/stage, not its own branch.
- [x] `v2/docs/v1-behaviors.md` — the TUI pipeline-tree entry (left pane merging `pipeline_list` snapshots with run rows by `workflowInvocationId`, unifying every run matching no stage into top-level ad-hoc nodes) records the branch-aware rule: `(project, branch)` as the match key, invocation-unit claiming, the displayed-pipelines-only claim scope, the blank-branch/invocation-less/dismissed-pipeline exclusions, the most-recently-started tie-break, and that `attributedRuns` timing aggregation stays invocation-id-only. The dock work-status entry (`stage-matched invocations do not count again`) and the multi-daemon-aggregation entry (`pipeline-attributed runs nest under their stage; every other run is a top-level ad-hoc row`) are updated to the same branch-aware rule so neither still reads as invocation-id-only. Sources name `v2/src/tui/tui-monitor-pipeline-tree.ts`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Observe section: the branch-aware attribution rule (`(project, branch)`, invocation-unit claiming), its exclusions (blank branch, invocation-less, dismissed-pipeline claims), the same-branch tie-break, and the attention-row label consequence.
- `v2/docs/v1-behaviors.md` — update the TUI pipeline-tree entry plus the dock work-status and multi-daemon-aggregation entries from invocation-id-only ad-hoc classification to the branch-aware rule.

## Implementer notes

- Suggested shape, keeping each guard quotable by one single-line `@mutate` directive:

  ```ts
  /** A blank branch never participates in branch attribution: it would collapse unrelated runs onto one stage. */
  function attributableBranch(branch: string): string | null {
    return branch.trim().length === 0 ? null : branch.trim();
  }

  function claimKey(project: string, branch: string): string {
    return `${project} ${branch}`;
  }

  /** Distinct (project, branch) claim keys of the runs joined to one stage's recorded invocation id. */
  function stageClaimKeys(invocationId: string, builderRuns: readonly DaemonListRunRow[]): Set<string> {
    const keys = new Set<string>();
    for (const run of builderRuns) {
      if (run.workflow?.invocationId !== invocationId) continue;
      const branch = attributableBranch(run.branch);
      if (branch !== null) keys.add(claimKey(run.project, branch));
    }
    return keys;
  }

  type StageBranchClaim = { stageNodeId: string; startedAt: number | null; keys: ReadonlySet<string> };

  /** One claim per stage that displays its own invocation's runs, restricted to displayed pipelines and mirroring buildStageNodes' elisions and dedup. */
  function collectStageBranchClaims(
    displayedSnapshots: readonly PipelineSnapshot[],
    builderRuns: readonly DaemonListRunRow[],
  ): StageBranchClaim[] {
    const claims: StageBranchClaim[] = [];
    for (const snapshot of displayedSnapshots) {
      const splitPosition = fanOutSplitPosition(snapshot);
      const stageKinds = resolveStageKinds(snapshot.name);
      const claimedInPipeline = new Set<string>();
      for (const stage of snapshot.stages) {
        if (isElidedPlaceholderStage(stage, splitPosition)) continue;
        if (isElidedGateStage(stageKinds.get(stage.stageId), stage.status)) continue;
        const invocationId = stage.workflowInvocationId;
        if (!claimInvocationId(claimedInPipeline, invocationId)) continue;
        const keys = stageClaimKeys(invocationId, builderRuns);
        if (keys.size === 0) continue;
        claims.push({
          stageNodeId: monitorPipelineStageNodeId(snapshot.pipelineId, stage.stageId, stage.branchKey),
          startedAt: stage.startedAt,
          keys,
        });
      }
    }
    return claims;
  }

  /** Last-started claim wins; an unstarted stage loses to any started one and later listing order breaks equal starts. */
  function mostRecentlyStartedClaim(claims: readonly StageBranchClaim[]): StageBranchClaim | undefined {
    let best: StageBranchClaim | undefined;
    for (const claim of claims) {
      if (best === undefined || startedAtRank(claim) >= startedAtRank(best)) best = claim;
    }
    return best;
  }

  function startedAtRank(claim: StageBranchClaim): number {
    return claim.startedAt ?? Number.NEGATIVE_INFINITY;
  }

  /** A claim matches an invocation when any one of its member runs — not just a representative — hits the claim's keys. */
  function invocationMatchesClaim(members: readonly DaemonListRunRow[], claim: StageBranchClaim): boolean {
    return members.some((member) => memberMatchesClaim(member, claim));
  }

  function memberMatchesClaim(member: DaemonListRunRow, claim: StageBranchClaim): boolean {
    const branch = attributableBranch(member.branch);
    return branch !== null && claim.keys.has(claimKey(member.project, branch));
  }

  /** invocationId -> stage node id, for invocations no stage records but that share a claimed (project, branch) via at least one member run. */
  function collectBranchAttributedInvocations(
    claims: readonly StageBranchClaim[],
    builderRuns: readonly DaemonListRunRow[],
    matchedInvocationIds: ReadonlySet<string>,
  ): Map<string, string> {
    const { byInvocation } = partitionRunsByWorkflowInvocation(builderRuns);
    const attributed = new Map<string, string>();
    for (const [invocationId, members] of byInvocation) {
      if (matchedInvocationIds.has(invocationId)) continue;
      const candidates = claims.filter((claim) => invocationMatchesClaim(members, claim));
      const claim = mostRecentlyStartedClaim(candidates);
      if (claim !== undefined) attributed.set(invocationId, claim.stageNodeId);
    }
    return attributed;
  }

  /** runId -> stage node id, expanded from the invocation-level map for filtering/membership checks. */
  function branchAttributedRunIds(
    attributedInvocations: ReadonlyMap<string, string>,
    builderRuns: readonly DaemonListRunRow[],
  ): Map<string, string> {
    const map = new Map<string, string>();
    for (const run of builderRuns) {
      const invocationId = run.workflow?.invocationId;
      if (invocationId === undefined) continue;
      const stageNodeId = attributedInvocations.get(invocationId);
      if (stageNodeId !== undefined) map.set(run.runId, stageNodeId);
    }
    return map;
  }
  ```

  `claimInvocationId` and `partitionRunsByWorkflowInvocation` are existing exports/functions (`tui-monitor-pipeline-tree.ts`, `tui-monitor-workflow-collapse.ts`). Inside `buildMonitorPipelineTreeJoin`, compute the pair once, claims from displayed pipelines only:

  ```ts
  const stageBranchClaims = collectStageBranchClaims(displayedSnapshots, builderRuns);
  const branchAttributedInvocations = collectBranchAttributedInvocations(stageBranchClaims, builderRuns, matchedInvocationIds);
  const branchAttributedRunIdMap = branchAttributedRunIds(branchAttributedInvocations, builderRuns);
  ```

- The stage join then covers both sources, its own recorded-invocation runs ordered first so `buildWorkflowTableRows` renders that group before any branch-attributed group:

  ```ts
  const stageRuns = [
    ...builderRuns.filter((run) => run.workflow?.invocationId === invocationId),
    ...builderRuns.filter(
      (run) => run.workflow?.invocationId !== invocationId && branchAttributedRunIdMap.get(run.runId) === stageNodeId,
    ),
  ];
  tableRows = buildWorkflowTableRows(stageRuns, builderRuns, new Set());
  ```

  with `claimedRunIds: stageRuns.map((run) => run.runId)` on the node. Keep this behind the existing `claimInvocationId(claimedInPipeline, invocationId)` gate so a stage that does not display its own invocation's runs claims nothing.

- Expansion reads the recorded ids rather than the snapshot record, which also removes the `pipeline` parameter:

  ```ts
  function stageRunsForExpansion(
    stage: MonitorPipelineTreeStageNode,
    builderRuns: readonly DaemonListRunRow[],
  ): MonitorPipelineTreeRunNode[] {
    const claimed = new Set(stage.claimedRunIds);
    if (claimed.size === 0) return stage.runs;
    const stageRuns = builderRuns.filter((run) => claimed.has(run.runId));
    const expandedInvocationIds = new Set(
      stageRuns.flatMap((run) => (run.workflow === undefined ? [] : [run.workflow.invocationId])),
    );
    return workflowTableRowsToRunNodes(stage.depth, buildWorkflowTableRows(stageRuns, builderRuns, expandedInvocationIds));
  }
  ```

- `isAdHocCandidate` gains one clause, checked against the invocation-level map (not a per-run map), placed after the `invocationId === undefined` early return so an invocation-less run keeps its current standalone treatment: `if (invocationId !== undefined && branchAttributedInvocations.has(invocationId)) return false;`.

- Directives that satisfy the checkpoint criteria above, each quoting text that occurs once in `v2/src/tui/tui-monitor-pipeline-tree.ts`:
  - keystone — `"const branchAttributedInvocations = collectBranchAttributedInvocations(stageBranchClaims, builderRuns, matchedInvocationIds);" -> "const branchAttributedInvocations = new Map<string, string>();"` (in `buildMonitorPipelineTreeJoin`)
  - cross-project — `"return \`${project} ${branch}\`;" -> "return branch;"` (in `claimKey`)
  - invocation-unit — `"return members.some((member) => memberMatchesClaim(member, claim));" -> "return memberMatchesClaim(members[0] as DaemonListRunRow, claim);"` (in `invocationMatchesClaim`)
  - dismissed-claim — `"const stageBranchClaims = collectStageBranchClaims(displayedSnapshots, builderRuns);" -> "const stageBranchClaims = collectStageBranchClaims(snapshots, builderRuns);"` (in `buildMonitorPipelineTreeJoin`)
  - blank branch — `"return branch.trim().length === 0 ? null : branch.trim();" -> "return branch;"` (in `attributableBranch`)
  - tie-break — `"if (best === undefined || startedAtRank(claim) >= startedAtRank(best)) best = claim;" -> "if (best === undefined) best = claim;"` (in `mostRecentlyStartedClaim`)
  - ad-hoc suppression — `"if (invocationId !== undefined && branchAttributedInvocations.has(invocationId)) return false;" -> "if (invocationId !== undefined && !branchAttributedInvocations.has(invocationId)) return false;"` (in `isAdHocCandidate`)

  The invocation-less-run criterion carries no directive: `partitionRunsByWorkflowInvocation` routes an invocation-less run to `withoutInvocation`, never into `byInvocation`, so `collectBranchAttributedInvocations` has no reachable single-line mutation that would attribute it — the exclusion is structural, not a guard to invert.

- The test builders in `v2/src/tui/tui-monitor-pipeline-tree.test.ts` default every run to `project: "demo"` / `branch: "main"`, so new fixtures must set `project`/`branch` explicitly for any pair that should not collide with a stage's, and the existing ad-hoc fixture needs a distinct pair — under the new rule a run sharing a stage's `(project, branch)` is attributed by design, so the fixture (not the assertion) is what changes.

- Attention rows need no production code change: `runIncidents` builds its pipeline attribution from `stage.runs` (`v2/src/tui/tui-attention-rows.ts`), which now includes branch-attributed members via `claimedRunIds`, so a newly branch-attributed failed run's attention row resolves through the same `pipelineTargetLabel` path as an invocation-matched one — its `where` becomes the pipeline's label plus `branchKey` instead of the run's own git branch. This is a real, operator-visible label change and is covered by the new `tui-attention-rows.test.ts` case above and the runbook clause, not by a "stays green unmodified" claim over files this subspec did not otherwise inspect.
