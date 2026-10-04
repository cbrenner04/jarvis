1. Make directive-reprompt replay reachable through a supported operator path. A paused direct `jarvis run start` implement run must retain sufficient durable resume context; synthetic workflow snapshots do not satisfy this because workflow-started implement runs reject live pause/resume.

2. Preserve the original effective `maxIterations` cap with `iterationsConsumed`. Resuming must allow only `maxIterations - iterationsConsumed` additional calls. Test through actual daemon reconstruction without manually injecting the cap.

3. Whenever a paused-status resume restores mutation, guard, or keystone reprompt context—including `invalid_token` and `missing_blocker` outcomes—it must inherit durable `iterationsConsumed`. Only unrelated `budget-soft-stopped` resumes retain a fresh budget.

4. Add production-path regressions and align canonical docs with these outcomes. Existing three-kind newest-event selection, sibling clearing, and verbatim guard-row restoration should remain unchanged.
