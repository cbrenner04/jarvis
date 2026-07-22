1. Prompt render coverage must be causal, not inferred from renderer-name text in test files. Comments, strings, skipped tests, or unasserted calls must not satisfy coverage; scoped tests must fail when the changed rendered output is altered. This is required by the “observes rendered output” acceptance criterion.

2. Coverage detection must support every registered prompt’s actual rendering path, including registry-ID and indirect renderers. It must not depend on a function name derived from the template path, which rejects legitimate production rendering contracts.

3. All changed registered prompts must be verified, including deletion-only diffs and untracked files. Changed-path classification must not depend on added diff lines, or prompt changes can bypass the completion gate.

4. The ready-finalization regression must exercise real prompt verification and demonstrably fail on the baseline. Merely injecting an existing `SurvivingMutationError` does not cover the new behavior or satisfy the explicit regression criterion.

5. Prompt verification must remain bounded and efficient. Scoped test execution must obey verification time/process limits and avoid redundant full-suite runs across changed prompts. This preserves the verifier’s existing bounds and prevents ready finalization from hanging or scaling linearly with prompt count.
