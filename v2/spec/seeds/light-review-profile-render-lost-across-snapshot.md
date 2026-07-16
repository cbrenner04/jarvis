---
name: light-review-profile-render-lost-across-snapshot
---

# Every daemon-run review step crashes — the prompt profile's render callbacks don't survive the workflow snapshot

A review workflow step carries a *prompt profile* whose renderers are **functions**
(`shared/prompts/review-profile.ts`):

```ts
render: {
  critic: (context) => string | Promise<string>;
  actuator: (context, verdict) => string | Promise<string>;
  debateRole?: (role, context, prior) => string | Promise<string>;
};
```

The step is persisted into the run's `workflow_snapshot` (JSON) on its way to the
daemon. JSON drops function-valued properties, so the round-tripped `review` step
comes back with `profile: null` (verified: the persisted `intent` snapshot's
`review` step has `"profile": null`). At execution, `v2/src/execution/review-cycle.ts:69`

```ts
if (args.profile) return await args.profile.render.critic(profileContext);
```

throws `args.profile.render.critic is not a function`, the run dies
`run_execution_failed`, and the daemon reconciles it to `killed`.

**Repro:** `jarvis1 intent` (v2, light review) on any seed. The split step
completes and stages the intent; the review step then crashes on every attempt
and the run ends `killed`. There is no operator-side workaround — config and
bindings are valid; re-running only reproduces it. This breaks **all** v2
daemon-run review steps (intent / plan / implement, light and debate), not just
intent.

## Decisions

- The snapshot persists only serializable profile identity — `profile.domain`
  (`intent | plan | implement`) plus the policy already in the spec — and the
  review-step executor **rehydrates the render map from a domain→profile
  registry** before invoking the cycle. Rules out serializing functions or
  passing the live profile across the boundary. This mirrors how bindings are
  re-resolved from `bindingResolution` context in
  `v2/src/daemon/daemon.ts` (`resolveWriteLoopBindings`) rather than shipped live.
- A test round-trips a review step through JSON (persist → reload) and asserts
  the reloaded step renders `critic`, `actuator`, and each debate role. Rules out
  the regression reappearing. **This is the point of the seed** — the crash is
  invisible until a review actually executes from a reloaded snapshot.
- The fix is domain-generic: one rehydration path covers intent, plan, and
  implement. Rules out an intent-only patch.

## Prerequisites

- None.

## Out of scope

- The stale verdict-owner marker: a `killed` review leaves
  `.jarvis-intent-review-verdict.md.owner` behind, and the next run's
  ownership check (`checkVerdictOwnershipBefore`,
  `v2/src/execution/review-intent-enforcement.ts`) reads it as a *foreign*
  collision and fails before reaching execution. That masks this crash until the
  operator deletes the marker. Worth its own seed (cleanup on non-completion), but
  not this behavior.

## Documentation updates

- `v2/docs/` review/workflow doc covering review-step execution — state that the
  prompt profile crosses the daemon boundary as a domain tag and is rehydrated
  from a registry, never as live callbacks.
