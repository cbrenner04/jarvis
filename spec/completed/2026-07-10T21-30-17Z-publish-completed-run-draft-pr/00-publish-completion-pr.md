# Publish completion commit and draft PR

## Problem

A completed v2 run commits its external-worktree snapshot locally but provides no remote review surface. No push, `gh` mediation, or bounded transient-retry seam exists in `v2/src` yet, so this work also creates the retry and `gh`-readiness seams it consumes.

## Decisions

- Publish only after the completion commit updates the branch — rules out pushing pre-completion state or opening a commitless PR.
- Treat publication as one retryable completion boundary — rules out reporting success after either push or PR creation fails.
- Use `git push -u origin <branch>` without an upstream and plain `git push` with one — rules out assuming tracking or always supplying a refspec.
- A non-fast-forward push rejection is permanent: stop without retry — rules out retrying a diverged-remote conflict as if it were transient.
- `baseRef` is the run's local base branch name, used verbatim as the PR base — rules out remote-qualifying it or a second default-base lookup that can diverge from worktree creation.
- Reuse the current branch's open PR without mutating its title or body; body-refresh and ready-flip belong to the downstream finalize spec — rules out reusing closed, merged, or title-matched PRs and rules out editing PR content here.
- When multiple open PRs share the current branch head, select the one whose base is `baseRef` — rules out an arbitrary pick.
- Create the PR as draft against `baseRef` with title `jarvis: complete run` and body `Spec: <specPath>` — rules out a ready PR, a second base, or inventing narrative before a richer PR-body consumer exists.
- Gate GitHub inspection and creation on a single `gh auth status` probe; a nonzero exit — including a missing `gh` binary (ENOENT) — is not-ready — rules out partially publishing while auth, install, or connectivity is unavailable, and rules out a separate binary/`--version` probe.
- A non-GitHub or missing-origin remote resolves through the `gh` preflight or push-failure path as a retryable stop preserving the durable boundary — rules out a silent skip or a third behavior.
- This work creates the v2 bounded transient-retry seam: 3 total attempts (2 re-attempts), flat 1000 ms backoff before each re-attempt, transient classification matching v1's shared and git/`gh` transport patterns (exit 0 is success, never transient), permanent failures attempt once, and each re-attempt emits `<op>: transient network error; retrying (attempt <n>/3)` — rules out unbounded retries, escalating backoff, retrying permanent failures, or reusing the distinct agent-spawn retry policy.
- Inject subprocess, delay, retry-notice, and `gh`-readiness seams — rules out tests using live git, GitHub, or wall-clock backoff.

## Scope

- Add the v2 bounded transient-retry seam and a `gh auth status` readiness probe.
- Add an idempotent completion publisher for push, open-PR lookup, and draft creation over those seams.
- Invoke it after the completion committer for standalone and workflow runs (once per workflow, after all steps and shrink), including completed-run publication retries.
- Preserve completed durable state and surface retryable publication failure when `gh` preflight, push, lookup, or creation fails.
- Cover first/later push, non-ff rejection, open/closed PR handling, tie-break, base selection, ordering, retries, publish-disabled and non-git-backed skips, and failure paths with automated tests.
- Update the durable PR lifecycle and v1 parity documentation.

## Acceptance criteria

- [x] A completed git-backed standalone run pushes its harness completion commit before ensuring an open draft PR against its existing `baseRef`.
- [x] A completed workflow run publishes exactly once after all steps and the hidden shrink complete, not per step.
- [x] A publish-disabled completed run skips push and PR entirely; a non-git-backed completed run skips push and PR entirely.
- [x] A branch without upstream tracking uses `git push -u origin <branch>`; a tracked branch uses plain `git push`.
- [x] Publication reuses the current branch's open PR without mutating its title or body, and creates a new draft when only closed or merged PR history exists; multiple open PRs on the head are disambiguated by `baseRef` base.
- [x] Initial draft creation uses title `jarvis: complete run` and body `Spec: <specPath>` against `baseRef`.
- [x] `gh` readiness is a single `gh auth status` probe; a nonzero exit (including a missing `gh` binary), or a failed push, PR inspection, or PR creation, returns retryable completion publication failure without changing the completed durable boundary; resume retries without duplicating the completion commit or an open PR.
- [x] A non-fast-forward push rejection stops publication without retry, distinct from a transient network failure.
- [x] Transient push and `gh` failures retry to 3 total attempts with flat 1000 ms backoff and emit `<op>: transient network error; retrying (attempt <n>/3)`; permanent failures attempt once.
- [x] Publication tests use injected subprocess, delay, retry-notice, and `gh`-readiness seams and require no live remote or GitHub credentials.
- [x] `v2/docs/write-behavior.md` documents completion push ordering, upstream behavior, draft PR identity/base/content, once-per-workflow publication, retry semantics with pinned values, and the `gh auth status` preflight.
- [x] `v2/docs/v1-behaviors.md` marks v2 completion push and draft-PR behaviors as ported.

## Documentation updates

- Update `v2/docs/write-behavior.md` as the durable operator/workflow home.
- Update `v2/docs/v1-behaviors.md` for parity status.
