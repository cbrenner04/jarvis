---
name: review-workflow-composition
---

# Compose one optional review workflow

Represent intent, plan, and implement review with one `ReviewPromptProfile` and one runner dispatch. The profile selects prompt/context, verdict lifecycle, and write-boundary policy as one domain contract. Keep `review-cycle.ts` and `review-debate.ts` as the cycle executors; render modules only assemble prompts. Move review prompt assembly to `shared/prompts/`, unify enforcement behind the profile, and preserve domain verdict, retry, landing, and external-worktree behavior while deleting replaced dispatch and enforcement copies.

## Decisions

- Select domain prompt/context, verdict lifecycle, and write boundary through `ReviewPromptProfile`; rules out `deferredIntentOutput`, `planReviewContext`, and `patchReviewContext` dispatch branches and a generic enforcement path that weakens domain safety.
- Preserve intent verdict ownership/collision rejection, diagnostic retention on failure, exclusion from validation/landing, and cleanup only after successful landing; rules out treating its reserved verdict as a reusable durable artifact.
- Preserve plan's durable in-tree verdict and implement's immutable-spec boundary through profile-selected policies; rules out a shared cleanup or mutable-spec policy for every domain.
- Keep light and debate as the two cycle behaviors; rules out domain-specific cycle executors.
- Run reviewed intent work in its existing external worktree through the shared profile; rules out a standalone review-cwd runner branch.
- Keep `review-cycle.ts` and `review-debate.ts` as executor boundaries; rules out execution from render modules.
- Require material net deletion across replaced runner, render, and enforcement surfaces; rules out abstraction layered over retained copies.

## Documentation updates

- `v2/docs/workflow-runner.md` — unified review dispatch, execution boundaries, enforcement, resume, and cwd.
- `v2/docs/prompts.md` — shared review profiles and prompt assembly ownership.
- `v2/docs/first-workflow-walkthrough.md` — common light/debate review semantics.

## Prerequisites

- Intent, plan, and implement review cycles have pinned critic, actuator, debate, verdict, and retry behavior.
- Publication workflows expose post-write landing as a composable hook.
