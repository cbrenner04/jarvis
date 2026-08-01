Verifying key codebase facts the advocate cited so the verdict is grounded in the actual TUI refresh behavior.
## Verdict: refinements required before merge

The spec correctly scopes same-tick polling, last-good retention, run-row preservation, and a monitor seam for downstream tree wiring. The gaps below are real contract holes an implementer could satisfy while missing intent. Address them in the subspec (decisions, tasks, and acceptance criteria); no split is needed.

### 1. Pin the `TuiMonitorState` pipeline seam

**Required outcome:** The spec must name the field added to `TuiMonitorState`, its value type (per-socket last-good `{ pipelines }` keyed the same way `refreshRuns` identifies clients), and initial behavior before the first successful poll (absent entry, not an empty overwrite).

**Rationale:** A sibling monitor intent will consume this field. Unpinned name/type invites incompatible assumptions between poll and tree wiring. Structure is part of the contract when downstream code depends on it.

### 2. Cover the initial refresh path

**Required outcome:** Acceptance criteria must verify that `refreshRuns(true)` issues `pipeline_list` once per connected client and that pipeline snapshot data is present on the state passed to `openMonitor` (or an explicit decision that initial polling merges into `currentState` before open). Periodic-tick ACs alone are insufficient: the initial path builds `draftState` and returns without `setState`, so an implementer could defer all pipeline polling until the first scheduler tick.

**Rationale:** Intent requires observation on the existing refresh cadence including first paint; the initial path is a distinct code branch today.

### 3. Require pipeline-only monitor updates

**Required outcome:** An acceptance criterion must assert that when `list` returns unchanged runs but `pipeline_list` returns new data, monitor state updates with the new per-socket snapshots.

**Rationale:** Without this, snapshots could live off-state and never reach ink when run rows are stable—defeating the monitor seam this slice owns.

### 4. Complete guard-inversion coverage

**Required outcome:** Beyond last-good retention, add `Mutation checkpoint:` acceptance criteria (or equivalent dedicated inversion tests) for every new guard that suppresses an effect:

- Skipping `pipeline_list` on refresh (cadence guard).
- Evicting or closing the monitor on `pipeline_list` failure.
- Clearing run rows when `pipeline_list` fails while `list` succeeds.

**Rationale:** Spec guidance requires each added/modified guard to have an inversion that turns the pinning test RED. The retention checkpoint alone does not cover cadence, eviction, or run-preservation guards.

### 5. Pin snapshot lifecycle with client membership

**Required outcome:** Decisions must state that per-socket pipeline entries are removed when the corresponding client is evicted from the `clients` map (including invoking-socket `list` failure eviction), and retained across non-evicting `list` or `pipeline_list` failures on other ticks.

**Rationale:** Last-good retention is per-daemon; lifecycle must stay aligned with connection identity or stale entries survive after disconnect.

### 6. Clarify `list` / `pipeline_list` failure interaction

**Required outcome:** One decision line on cross-RPC behavior within a tick:

- Non-invoking `list` failure: whether `pipeline_list` still runs that tick (recommended: yes—observation is independent of list merge).
- Invoking-socket `list` failure → client eviction: pipeline entry for that socket drops with the client.
- Successful `{ pipelines: [] }` overwrites prior non-empty snapshot (daemon truth, not “never polled”).

**Rationale:** Intent guards pipeline failure only; it does not define interaction with existing `list` eviction or empty-success semantics. Ambiguity here produces inconsistent degradation.

### 7. Acknowledge existing test fixture churn

**Required outcome:** Tasks must include updating existing `tui-entry.test.tsx` method-sequence pins (and similar per-tick assertions) so each refresh tick expects `pipeline_list` alongside `list`.

**Rationale:** Mechanical scope within one atomic subspec; omitting it strands implementers on unrelated RED tests.

### 8. Minor tightenings (low cost, include if editing ACs)

- Cadence AC: “one `pipeline_list` per entry in the `refreshRuns` client loop” (same set `list` uses), with per-fake-client call counts keyed by socket path.
- Client parse AC: assert full `PipelineSnapshot` wire shape (or reference the type), not only `branchKey` and `workflowInvocationId`.
- Optional one-liner: polled snapshots are the daemon `pipeline_list` wire shape at implementation time; timing-field enrichment belongs to the tree-model sibling.

### Not required

- Splitting the subspec.
- Cross-daemon merge semantics (correctly deferred).
- Ink rendering or operator-visible degradation banners (monitor integration).
- Enumerating every stub file (`typecheck` AC suffices).
- Mandating RPC ordering within a tick beyond “same pass as `list`.”

**Summary:** Approve the intent and atomic scope. Before merge, close the monitor-state contract, initial-tick and pipeline-only-update verification, guard-inversion gaps, client-lifecycle alignment, and `list`/`pipeline_list` failure matrix—these are the highest-risk paths to a passing but wrong implementation.