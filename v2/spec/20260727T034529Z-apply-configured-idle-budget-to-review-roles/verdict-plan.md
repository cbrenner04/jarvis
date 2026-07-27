- Split the oversized subspec into independently testable construction/config-resolution, execution-propagation, and documentation-alignment subspecs. Assign every original task and acceptance outcome exactly once, and link every replacement from `index.md`.

- Cover every workflow-driven review execution seam: standard review, non-durable profile review, full review debate, and actuator-only debate retry. Each seam must demonstrably preserve configured positive and zero budgets; otherwise independent input reconstruction can silently drop the value.

- Separate construction evidence from execution evidence. `v2/src/commands/workflow.test.ts` must verify review and review-debate payload stamping and fail when that wiring is removed. Named execution-layer tests must prove the value reaches `invokeReviewRole` through each relevant seam and fail when propagation is broken.

- Add explicit disabled-watchdog evidence. Tests must show `0` survives construction and execution and reaches the invocation boundary without activating the 90-second fallback. Existing write-bound coverage does not establish review-role behavior.

- Make presence and precedence semantics unambiguous: configured positive or zero values govern review steps; absence leaves `idleOutputMs` unstamped; only the invocation layer supplies the 90-second fallback. Preserve existing write-step behavior. This distinction is necessary because write-bound resolution collapses states that the review contract must retain.

- Retain documentation outcomes across all identified durable pages, covering configured, absent-key fallback, disabled, and historical pre-fix behavior without contradictory fixed-budget or write-only claims.
