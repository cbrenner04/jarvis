- Require the stubbed agent binding to derive output from the rendered split prompt. It must produce legacy bundled output under the pre-change contract and new fan-out/rationale output only under the revised contract; otherwise the regression could pass independently of prompt wiring.

- Define discriminating fixtures. The multi-surface seed must describe one behavior necessarily spanning persistence, daemon, and CLI, while the single-surface seed must contain multiple related concerns within one boundary. This proves both cross-surface fan-out and resistance to spurious fragmentation.

- Strengthen the staging oracle to establish exactly one primary implementation surface per intent, with distinct persistence, daemon, and CLI owners. Surface mentions in prerequisites may be excluded; simple substring presence is insufficient because bundled intents could satisfy it.

- Require staged outputs to satisfy ready-intent content validity and the write operation to complete successfully. Durable Git-backed landing remains out of scope under the subprocess-free constraint.

- Require reproducible negative controls for both fixtures: the pre-change contract must yield rejected bundled multi-surface output and rejected single-surface output lacking the mandated one-line rationale. The fan-out inversion must exercise this same observable staging oracle.

- Keep the work as one subspec. Both fixtures and controls exercise the same production write seam and shared harness, so no independently testable split is needed.
