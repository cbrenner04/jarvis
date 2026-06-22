# Verdict — Refinements Required

The spec is sound in direction (mirror plan's no-commit external-write path for `intent`, per the intent's preferred direction) but underspecifies the boundary/isolation guarantees that are the feature's whole point. Two issues are load-bearing design gaps; the rest are cheap wording/AC additions. Refine as follows.

## Must fix (design gaps)

1. **Add a target-repo boundary check over `project.root`.** Plan's no-commit path runs *two* assertions — one guarding the live checkout against stray writes, one guarding the external spec root — but the spec mirrors only the external one. Because intent's no-commit cwd is `project.root`, a splitter that writes stray files into the live checkout would go undetected, leaving the isolation guarantee (the reason this mode exists) unenforced. The spec must require a boundary assertion over `project.root` and add an acceptance criterion covering pollution *inside the target checkout*, distinct from the existing external-sibling rogue-write AC.

2. **Define the external-root boundary semantics; do not assert verbatim reuse of the external-spec boundary helper.** The existing external boundary helper flags every entry under the external root except a single spec directory. Intent's root `~/.jarvis/specs/<id>/` legitimately contains `ready-intents/`, the stage dir, and any prior no-commit plan spec dirs — verbatim reuse would flag all of them. The spec must specify the allowed-entry set explicitly (e.g., `ready-intents/`, the stage dir, `*-<slug>/` plan dirs) via an intent-specific check, **or** scope the rogue-write scan to the stage dir only and rely on the new `project.root` check (#1) for checkout pollution. Separate the reusable stage-*content* validation (filenames, frontmatter `name:`, `## Prerequisites`) from the root *scan*, which is not reusable as-is.

3. **Clean the external stage dir at start-of-run, and assert stage cleanup.** The committed path's stage lives in a throwaway per-run worktree and is discarded implicitly; the external stage is a fixed path that survives a crash and would poison the next run's content validation. The spec must require clearing (rm-then-mkdir) the external stage before use, and add an acceptance criterion for stage removal on success. (Concurrent-run clobbering is *not* in scope — this is a single-operator repo.)

## Should fix (cheap, real)

4. **Make the emitted next-step command runnable.** The success output prints `jarvis1 plan <abs-path>`, but the spec itself states no-commit plan-consumption has no `repo:` binding and the operator must pass `--repo`. As printed the command fails. Emit `jarvis1 plan --repo <project> <abs-path>`, or have the AC state the operator must supply `--repo`.

5. **Pin atomic multi-intent move ordering.** The collision AC promises "no partial writes," but no decision pins the pre-check-all-destinations-then-rename ordering for the external path (the committed path does this). Add one decision line so a partial-write implementation isn't conformant.

6. **Reword "byte-for-byte unchanged" → behavioral preservation.** The tasks thread `additionalReadDirs` through `runIntentSplitTurn` and make `stagingDir`/the split-prompt builder accept absolute paths — shared functions every committed run flows through, so "byte-for-byte unchanged" is literally false. State the real contract: committed-path *behavior* is preserved (signatures gain optional params defaulting to current behavior), which the ACs ("commit-path and draft-PR tests stay green") already capture correctly.

7. **Record the `ready-intents/` location rationale as deferred, not established parity.** No code yet reads the external `ready-intents/` directory (no-commit plan-consumption is out of scope). Justifying the location by an unbuilt reader is invented precision. Keep the location choice but record it as `Deferred to first consumer: ready-intents/ read path — pin when no-commit plan consumes it` rather than asserting parity with a future reader.

8. **Document the cursor/opencode write limitation as a named failure mode.** Under no-commit the only writable target is the external stage reached via `additionalReadDirs`, which is read-only for cursor/opencode — a fallback to those agents yields zero files and fails validation. Deferring the *fix* is fair (inherited `--add-dir` limitation, not introduced here), but the docs updates (`v2/docs/v1-behaviors.md`) must name this failure mode rather than leave it silent.

9. **Clarify file-seed behavior under a non-git root.** AC requires success against a non-git `project.root`, while file seeds are still read from on-disk `<targetDir>/wip-intents/`. Add one clarifying line: file seeds read from on-disk `<targetDir>/wip-intents/` regardless of git presence; inline seeds need no repo structure.

## No action
- AC asserting the splitter's spawn options carry `additionalReadDirs` is the correct contract for a harness subspec — structure is the contract here.
- Concurrent same-project run clobbering — out of scope for a single-operator harness.

Rationale: #1–#2 are required because "mirror plan" was applied as a slogan rather than traced through plan's two-check boundary logic and the helper's single-allowed-entry semantics — without them the isolation guarantee and rogue-write ACs are satisfiable while the actual gap remains open. #3 addresses a crash-state hazard the committed path is immune to by construction. #7 enforces the repo's deferral-over-invented-precision guidance. The remainder are internal-consistency and documentation-completeness fixes that keep the spec self-consistent and the v1-behaviors baseline honest.