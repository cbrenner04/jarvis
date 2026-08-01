Reviewing implementation and tests against the spec to issue a grounded verdict.
## Verdict: test coverage must match checked acceptance criteria

Implementation matches the subspec decisions (same-tick polling, last-good retention, invoking-socket eviction via client-membership filter, empty-success overwrite, monitor seam on initial path). Polling logic does not need rework. The gap is that several acceptance criteria are checked while tests only partially exercise them.

### Required outcomes

1. **Lifecycle AC must be fully exercised (AC: invoking-socket eviction + cross-daemon retention on non-evicting failures).** The combined lifecycle test proves invoking-socket `list` failure removes that socket’s snapshot and leaves the other daemon’s snapshot on that tick. It does not prove:
   - `pipeline_list` failure on one daemon on a later tick retains other connected daemons’ snapshots.
   - Non-evicting `list` failure on one daemon retains another daemon’s snapshots.
   The `otherDaemonClient` fixture is wired into a three-client array but never connected (`socketDiscovery` returns only two sockets); the second periodic tick has no assertions. Extend or split tests so every branch named in the lifecycle AC is asserted, and remove unused client fixtures.

2. **Non-invoking `list` failure test must assert cross-daemon retention (spec decision + lifecycle AC).** The non-invoking test correctly proves `pipeline_list` still runs for the failing daemon and stores its snapshot. It must also assert the other daemon’s snapshot remains present when a non-invoking `list` fails—behavior the spec pins but the test name does not cover.

3. **Cadence ACs must pin `list` alongside `pipeline_list` (AC: initial and periodic ticks).** Initial and periodic dual-daemon tests count only `pipeline_list` calls. Acceptance criteria require one `pipeline_list` per socket **alongside** `list` in the same client loop. Add per-socket `list` call assertions (or equivalent method-sequence pins) so dropping `list` while keeping `pipeline_list` turns these tests red.

### Rationale

Checked acceptance criteria and spec decisions define a failure matrix for snapshot lifecycle and same-pass RPC cadence. Partial tests let regressions slip while ACs stay green—especially cross-daemon retention on non-evicting `list`/`pipeline_list` failures, which the lifecycle AC explicitly requires but current assertions do not reach. Tightening tests closes that honesty gap without changing the polling contract the subspec already landed correctly.