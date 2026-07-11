- Preserve existing `review-debate` loader support alongside new `review` support. `loadWorkflowSteps` must accept and return `write | review | review-debate` steps, materializing and validating all four debate role orders.

- Restore coverage for debate loading and aggregated four-role binding failures.

- Align durable workflow and parity docs with the preserved loader contract; they must not exclude `review-debate` while the review-debate dispatch documentation states it is loader-supported.

This change must be additive: the completed spec introduces `review` loading and does not establish an intentional removal of the already-supported public `review-debate` loader behavior.
