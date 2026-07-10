# Publish completion commit and draft PR

## Problem

A completed v2 run commits its external-worktree snapshot locally but provides no remote review surface.

## Decisions

- Publish only after the completion commit updates the branch — rules out pushing pre-completion state or opening a commitless PR.
- Treat publication as one retryable completion boundary — rules out reporting success after either push or PR reconciliation fails.
- Use `git push -u origin <branch>` without an upstream and plain `git push` with one — rules out assuming tracking or always supplying a refspec.
- Reconcile only an open PR whose head is the current branch — rules out reusing closed, merged, or title-matched PRs.
- Create the PR as draft against the run's `baseRef` — rules out resolving a second default base or creating a ready PR.
- Use title `jarvis: complete run` and body `Spec: <specPath>` for initial creation — rules out inventing narrative before a richer PR-body consumer exists.
- Require `gh` readiness before GitHub inspection or creation — rules out partially publishing while auth or connectivity is unavailable.
- Apply the established bounded transient retry policy to push and every `gh` mediation call — rules out unbounded retries or retrying permanent failures.
- Inject subprocess, delay, and retry-notification seams — rules out tests using live git, GitHub, or wall-clock backoff.

## Scope

- Add an idempotent completion publisher for push, open-PR lookup, and draft creation.
- Invoke it after the completion committer for standalone and workflow runs, including completed-run publication retries.
- Preserve completed durable state and surface retryable publication failure when push, `gh` preflight, lookup, or creation fails.
- Cover first/later push, open/closed PR handling, base selection, ordering, retries, and failure paths with automated tests.
- Update the durable PR lifecycle and v1 parity documentation.

## Acceptance criteria

- [ ] A completed git-backed standalone or workflow run pushes its harness completion commit before ensuring an open draft PR against its existing `baseRef`.
- [ ] A branch without upstream tracking uses `git push -u origin <branch>`; a tracked branch uses plain `git push`.
- [ ] Publication reuses the current branch's open PR and creates a new draft when only closed or merged PR history exists.
- [ ] Initial draft creation uses title `jarvis: complete run` and body `Spec: <specPath>`.
- [ ] Failed `gh` readiness, push, PR inspection, or PR creation returns retryable completion publication failure without changing the completed durable boundary; resume retries without duplicating the completion commit or an open PR.
- [ ] Transient push and `gh` failures use the established bounded retry count, classification, backoff, and retry notice; permanent failures attempt once.
- [ ] Publication tests use injected subprocess and retry seams and require no live remote or GitHub credentials.
- [ ] `v2/docs/write-behavior.md` documents completion push ordering, upstream behavior, draft PR identity/base/content, retry semantics, and `gh` preflight.
- [ ] `v2/docs/v1-behaviors.md` marks v2 completion push and draft-PR behaviors as ported.

## Documentation updates

- Update `v2/docs/write-behavior.md` as the durable operator/workflow home.
- Update `v2/docs/v1-behaviors.md` for parity status.
