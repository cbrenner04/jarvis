I've confirmed the substantive findings against the code. Issuing the verdict.

---

## Verdict

The spec's core objective is met: a mixed subspec (some automated, some human-only criteria — the observed #536 case) completes the draft-PR path, the blocker-strip guard fires at both checks, marker matching is trailing-anchored (no false positives), and the PR human-verify checklist renders. The following must still be fixed.

### Required outcomes

**1. The all-human-only completion guard must use a work signal that can actually change (upheld — blocks an accepted AC).**
The edit-signal guard compares HEAD against `preIterationHead`, but `preIterationHead` is captured at the *start of the same iteration*, and the harness — not the agent — owns commits, committing only when a criterion is ticked or on completion. An all-human-only subspec ticks nothing, so HEAD never advances within the iteration and `hasCodeChanges` is structurally always `false`. Consequences:
- The post-agent positive completion branch for an all-human-only subspec is unreachable, so the accepted AC "a subspec whose criteria are all human-only … completes only after the agent commits at least one code change" cannot be satisfied — the subspec never completes even after real work.
- The start-of-iteration path (uncommitted human-only tick on an all-human-only subspec) returns `continue` without committing the tick and re-enters identically, spinning to the iteration cap (exit 5).

Required: detect "the agent did work this run" with a signal that genuinely reflects it — e.g. working-tree dirtiness, or HEAD compared against a run-start (not iteration-start) baseline — and reconcile the AC's "committed a code change" wording with the harness rule that agents don't commit. Both the start-of-iteration and post-agent paths must use the corrected signal. A test must exercise the *positive* completion path of an all-human-only subspec, not only the no-op negative.

**2. The completing commit/summary must carry the human-verify framing (upheld — operator-facing AC gap).**
The `N/total (M human-verify)` label is threaded only into the WIP-progress commit, not into `commitSubspec` (the completing commit) or the run summary. The accepted AC requires a completed human-only-remaining run to report the automated criteria as satisfied and label the unchecked human-only remainder as human-verify (e.g. `4/7 (3 human-verify)`). The completion path currently omits that explicit framing. Required: the operator-facing completion artifact (completing commit message and/or run summary) reports the count with the human-verify remainder.

**3. The blocker-strip telemetry must not double-count completed iterations (upheld — minor correctness).**
When a blocker is stripped because only human-only criteria remain, the strip records an `ok` telemetry kind and control then falls through to the completion path, which records a second `ok` — inflating the completed-iteration summary counter for one agent run. The existing base-ref-green strip precedent deliberately uses a non-`ok` kind to avoid this. Required: the human-only blocker-strip must not be counted as a completed iteration (use a non-`ok` kind or otherwise exclude it).

### Verify, not required

**Composite prompt-body revision.** Subspec 01 scoped the bump to the `patch.rules` fragment revision (done, 6→7), but the composite `patch.prompt.body` stayed at r6 while its rendered `@r6.*` fixtures changed in place. Confirm whether this repo treats `@rN` body snapshots as immutable-per-revision; if so, the composite body revision should also bump. Defensible as-is otherwise.

### Not required (accept as-is)

PR collection over multi-subspec indexes listing human-only criteria from not-yet-started subspecs (self-corrects by ready time; no AC mandates the gating), index-relative subspec links not resolving in a GitHub PR body (text attribution still satisfies the AC), and the start-of-iteration strip emitting no telemetry record (observability symmetry only). None block an accepted criterion.