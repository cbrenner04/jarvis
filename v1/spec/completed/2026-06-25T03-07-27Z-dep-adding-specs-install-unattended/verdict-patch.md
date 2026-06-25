I've confirmed the findings against the code. Issuing the verdict.

---

# Verdict — `dep-adding-specs-install-unattended`

The mechanism is sound, but the implementation omits two safety properties that were the explicit point of this spec and ticks acceptance criteria that the code does not satisfy. **Not mergeable as-is.** Required outcomes below.

## Blocking — checked ACs are currently false

1. **`installCommand` must actually be configurable (AC 00-#6).**
   The config loader does not accept the key: `installCommand` is absent from `allowedProjectKeys` (`config.ts:496`) and there is no parse/copy block populating `project.installCommand` (contrast `readyCommand` at `config.ts:477`). The strict-key loop therefore *throws* on any config that sets `installCommand`, bricking config load, and `project?.installCommand` at `iteration.ts:384` is permanently `undefined`. Outcome: a project may set `installCommand`, it loads without error, and the harness uses it; unset still defaults to `bun install`. Today this AC is checked but false, and `config.md` documents a key that breaks the operator's config.

2. **Promotion must be atomic (AC 00-#1, 00-#4; decision "Promotion is atomic").**
   `installDeps` (`dep-install.ts:31-58`) removes the symlink in place and installs directly into the worktree's `node_modules` — no temp dir, no swap, no success sentinel. A failed mid-install leaves a *partial real* `node_modules`, and the resume-skip (`worktree.ts:471-479`) `continue`s on any non-symlink target, reading that partial as promoted-and-healthy. This is exactly the corruption the spec required the design to prevent. Outcome: a real `node_modules` exists only when the install completed successfully; an interrupted/failed install leaves no state that resume misreads as healthy (install to a temp location and swap on success, or gate the promotion on a success sentinel).

## High — explicit decisions violated

3. **The uncommitted-ticks commit path must also fire the install.**
   The start-of-iteration uncommitted-ticks path (`iteration.ts:524-563`) commits (`commitSubspec`/`commitWipProgress`) and pushes but never calls `maybeInstallDeps`. The spec decision is explicit that *any* commit landing a `package.json`/`bun.lock` change fires the install, naming all commit paths; this path can land such a change and skips install, leaving the next iteration's typecheck broken. Outcome: every commit path that can land a dep change triggers detection+install, including the uncommitted-ticks path.

4. **The harness lockfile commit must reach the remote before the ready gate.**
   In the completed-subspec path, `pushCurrent` runs at `iteration.ts:1146` and `maybeInstallDeps` (which creates the lockfile commit) at `1154` — *after* the push. The regenerated-lockfile commit is created locally but never pushed by that path, so the PR head can ship with a stale lockfile, defeating the stated intent of AC 00-#3. Outcome: when the harness commits the regenerated `package.json`/`bun.lock`, that commit is on the pushed branch head before the ready gate runs (install/commit before the push, or push again after committing).

## Medium

5. **Lockfile staging must tolerate a missing path.**
   `commitLockfileChanges` runs `git add package.json bun.lock` unconditionally (`dep-install.ts:75`); if only one path exists, `git add` errors on the missing pathspec and the install lands installed-but-uncommitted. Outcome: staging succeeds when only one of the two files is present (stage only existing paths, or use a form that tolerates absence).

## Name the limitations (no behavior change required, but record them)

6. **Dep-change detection is root-only and single-commit.** `detectDepChange` (`dep-install.ts:14-29`) matches only top-level `package.json`/`bun.lock` and inspects only `HEAD~1..HEAD`. Acceptable under single-operator/bun-only scope, but the narrowness is currently implicit. Record it alongside the already-noted non-bun deferral so the boundary is explicit rather than read as broader than it is.

## Confirm before relying on it

7. **Composite prompt revision vs. mutated rendered fixture.** The `patch.rules` fragment correctly bumped to revision 6 (AC 01-#3 met). But the composite `patch.prompt.body` stayed at revision 5 while its rendered `@r5` fixture content changed. Confirm against the prompt-registry revision contract whether revision-keyed rendered snapshots are immutable: if so, the composite revision must bump (and the fixture/test move to the new revision); if composite revisions are intentionally independent of embedded-fragment revisions, no change is needed. Do not leave this unresolved.

## No action

- Continue-on-failure (log loudly, run continues; operator resolves) matches the deliberately-rewritten decision — correct as designed.
- The resume-skip is correctly scoped to the `node_modules` entry only (`worktree.ts:471`); other symlink entries still throw on a non-symlink target.