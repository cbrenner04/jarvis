1. Make the “untracked worktree-local file” decision observable enough to rule out tracked ignore-state changes. The spec must require that patch runs leave repository-tracked ignore files unchanged while keeping `.active-spec-path` unstaged/uncommitted, because “git status stays clean” alone does not exclude the wrong alternative of mutating tracked ignore metadata.

2. Pin the path-format contract for all active-spec cases, including external specs that resolve to an absolute path. The intent requires patch preflight to write the same path `prepareActiveSpecPath` produces, so the spec needs acceptance coverage that the marker matches that value, not just that a marker exists for in-repo specs.

3. Separate durable behavior from internal bypass seams. The spec may keep internal skip-path coverage for the worktree-setup bypass, but operator-facing docs should describe only the durable behavior boundary: git-backed patch worktrees get the marker; `git:false` or any run that skips worktree setup does not. This avoids documenting incidental flags as public semantics.

4. Align the documentation acceptance criterion with the stated documentation scope. The spec already says docs must cover both population and skip cases; completion should therefore require `v2/docs/v1-behaviors.md` to record both, so the durable behavior baseline stays complete for changed existing functionality.
