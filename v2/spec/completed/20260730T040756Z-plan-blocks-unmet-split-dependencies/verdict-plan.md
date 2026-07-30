1. Require both prerequisite outcomes at command level: missing behavior blocks with non-zero exit and no spec; observable behavior drafts successfully. This prevents an always-blocking fake from satisfying the regression and proves the gate’s pass path.

2. Define the prompt contract behaviorally and precisely. Coverage must detect removal or reversal of instructions to inspect the repo, evaluate the named prerequisite, block without drafting when absent, and proceed when observable.

3. Use an unambiguous repository artifact as the prerequisite evidence. The intent/spec text itself must not accidentally satisfy the check. In git-disabled mode, describe this as filesystem observability, not committed-history validation.

4. Align blocker and exit terminology with the actual `jarvis1 plan` contract. Any v2-only event name must not be attributed to v1; documentation should distinguish shared prerequisite policy from engine-specific signals.

5. Remove the unverifiable “fails against the pre-fix harness” claim because production behavior is intentionally unchanged. Require reproducible mutation sensitivity instead: the regression must fail when the production prerequisite instruction is removed or reversed, while the separate fake-branch inversion proves assertion sensitivity.

No subspec split is required; the regression and documentation form one focused change.
