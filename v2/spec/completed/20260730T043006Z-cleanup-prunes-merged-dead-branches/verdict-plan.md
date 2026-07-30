- Bind deletion authority to an unambiguous merged PR in the candidate repository. The current local-head OID must match that PR’s head OID; reused branches, post-merge commits, conflicting matches, open PRs, and lookup ambiguity/errors must fail closed.

- Run every PR lookup in the registered project’s repository context. Cover identical branch names with different PR states in two repositories.

- Require apply-time revalidation of head/tracking OIDs, PR authority, checkout status, and run ownership. A ref changed after preview must not be deleted.

- Extend durable-run, daemon-run, and lookup-failure guards to head-only candidates. Discover checked-out branches through complete repository worktree metadata, including linked worktrees outside Jarvis-managed directories.

- Require exact fully qualified ref inspection and deletion. A similarly named tag must not make `refs/remotes/origin/<branch>` appear present, and orphan tracking refs remain outside candidate discovery.

- Define and test within-candidate failure semantics: whether later ref deletion, archival, socket cleanup, and stranded-artifact cleanup continue; when retirement success may be reported; and how failures aggregate into the exit status. No failed deletion may emit success.

- Define registered-project discovery failure behavior. Missing, inaccessible, or non-Git roots must be identified, unrelated projects must continue, and cleanup must return nonzero. Deduplicate registry entries resolving to the same repository.

- Include project identity with every ref preview, success, and failure line because full ref names are repository-local. Cover identical refs across projects.

- Add failing-before-fix and guard-inversion coverage for every new safety guard, including OID mismatch, historical/reused branches, apply-time races, run ownership, external linked worktrees, exact-ref collisions, project isolation, discovery failures, and deduplication.

- Split the oversized subspec into independently testable replacements. Distribute every existing task and acceptance outcome exactly once across them, retain all dry-run, preservation, documentation, and verification requirements, and link every replacement from `index.md`.
