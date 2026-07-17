# Abandon refuses reviewed or ambiguous PR ownership

Subspec 00 closes whatever single matching PR it resolves. Abandon must not force-retire operator-reviewed work or act under ambiguous PR ownership. Layer two PR-eligibility gates onto the abandon flow, evaluated before any PR close, worktree removal, or branch deletion.

Refuse when the branch's PR is ready (non-draft) — that is operator-reviewed work abandon must not close. Refuse when more than one open PR matches the branch — ownership is ambiguous and abandon could close the wrong one. A single open draft PR still passes.

## Decisions

- Refuse a ready (non-draft) matching PR; rules out force-retiring operator-reviewed work.
- Refuse when multiple open PRs match the branch; rules out closing the wrong PR under ambiguous ownership.
- Evaluate PR-ownership gates before any removal or close; rules out partial retirement on an ineligible target.

## Task checklist

- After resolving the branch's open PRs, refuse (nonzero, nothing removed/closed) when the single match is non-draft or when more than one open PR matches.
- Keep the single-open-draft path passing through to the 00 retirement flow.

## Acceptance criteria

- [x] A test asserts `cleanup --abandon <name>` refuses when the branch's matching PR is ready (non-draft), closes nothing, removes nothing, and exits nonzero; it fails against the pre-fix code.
- [x] A test asserts `cleanup --abandon <name>` refuses when multiple open PRs match the branch, closes nothing, removes nothing, and exits nonzero.
- [x] A test asserts a single open draft PR still passes the gates and retirement proceeds (worktree/branches removed) — guarding the happy path against the new refusals.

## Documentation updates

- `v2/docs/operator-runbook.md` — extend the `--abandon` recovery entry with the ready-PR and multiple-open-PR refusals and how to resolve each (merge or hand-close the reviewed PR; disambiguate the extra PRs).
