1. Require connected re-dispatch coverage where workflow execution itself reaches locked materialization and the write callback. Separate mocked dispatch and direct materializer calls do not prove the preflight no longer strands re-dispatch.

2. Cover both implement and plan re-dispatch, with and without `--reset-despite-dirty`. The documented contract includes both workflows, and the override must not change husk classification.

3. Preserve the materializer’s safety boundary: re-dispatch may reclaim only a proven unregistered non-Git husk. Registered or inconclusively classified paths must remain untouched and refuse appropriately; cite existing materializer safety tests and add re-dispatch-level evidence.

4. Define the regression fixture’s expected branch/HEAD deterministically. The intended behavior may reuse the surviving branch; clean-slate retirement or fresh `--base` semantics are out of scope.

5. Retain explicit negative coverage proving unrelated `git status` failures still produce the existing fail-closed recovery text under both override states. This is required to prevent widening the exception beyond Git’s missing-repository diagnostic.
