- Ensure deletion cannot escape the plan worktree through symlinks. An escaped ready-intent must remain untouched and no external file may be removed. This is required by the checkout-safety acceptance criterion.

- Use platform-correct containment semantics so valid worktree paths are not rejected on non-POSIX systems, while all `..` and absolute escapes remain rejected.

- Add plan-command integration coverage proving the Git contract: on `commit: true`, only the consumed ready-intent deletion and spec tree land in the same `plan: draft` commit after boundary enforcement, with byte-identical `intent.md`; on `commit: false`, the source remains unchanged. Helper-only tests do not verify the required commit and boundary behavior.
