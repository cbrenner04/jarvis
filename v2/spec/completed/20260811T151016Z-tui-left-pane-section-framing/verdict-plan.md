1. Require updating existing row-budget assertions and mutation directives that encode the current attention/Queue-only reservation. Their original coverage must remain valid after adding the Work reservation.

2. Define one consistent Work-count and row-budget contract across rendering and scroll-follow behavior. Add evidence that selection remains visible during expansion or scrolling after reserving the Work heading; preserving the full row-ID model alone does not prove viewport correctness.

3. Broaden liveness coverage from “terminal” to every run/ad-hoc row where `isLive === false`, including paused/not-live rows. Tests, mutation checkpoints, and documentation must all enforce no liveness atom for any not-live state while retaining `live` for live rows.

4. Clarify clipping semantics: a non-empty full work model paints `Work (N)` even when the visible tree-row budget is zero; only a genuinely empty full model suppresses the heading. Pin this boundary case to prevent counting or suppression from depending on the clipped viewport.

5. Split Queue framing from Work framing/budgeting into independently testable subspecs. Queue needs its own pre-fix-failing behavior test and keystone evidence. Preserve every original task and acceptance outcome exactly once across the replacement subspecs, and link every replacement from `index.md`.
