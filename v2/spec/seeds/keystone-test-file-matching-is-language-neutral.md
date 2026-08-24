---
name: keystone-test-file-matching-is-language-neutral
---

# Keystone/mutation test-file matching is JS-only, so non-JS plans are systematically rejected as unsatisfiable

## Problem

`isTestFileReference` (`shared/mutation-checkpoint-criteria.ts:155`) recognizes only JS-style test filenames — `/\.test\.[cm]?[jt]sx?$/i` or a token containing `.test.`. It is the single chokepoint feeding `isKeystoneCheckpointBlock`, `isGuardMutationCheckpointBlock`, and (via `selectKeystoneCheckpointCriteria`) `findUnsatisfiableKeystoneCriteria`. So a canonical, correctly-shaped keystone bullet naming a Swift/XCTest file (`ChessPracticeTests/RootContentTests.swift`) is "self-marked but not selectable" and the whole plan draft is rejected `contract_miss (artifact.exists): … unsatisfiable keystone criterion`.

The plan prompt/spec-guidance steers the drafting agent to author keystones for headline changes, so in a Swift/Ruby/Python/Go repo the agent is pushed into writing a bullet the validator is guaranteed to refuse — a systematic draft-then-reject loop, not an agent error. `pipeline resume` redrafts and reproduces it; only hand-editing the staged tree plus `pipeline recover` gets past it (and on a fan-out lane even `recover` refuses — see `pipeline-recover-lands-fan-out-lanes`).

Observed 2026-08-24 dogfooding a `fast` pipeline on `cbrenner04/chess-mvp-yolo` (Swift/SwiftUI, XCTest `*Tests.swift`): plan lane `ios-app-project-and-make-build-test`, run `97dfc735`, blocked `contract_miss` on a canonical-looking Swift keystone. Third JS-assumption gap from the same session after #2954 (node_modules symlink) and #2957 (`bun run ready`). Issue #2982.

The rejection message shows a bullet that looks perfectly canonical, giving no hint the *filename pattern* is why it is unselectable — it cost the operator a source dive to decode.

## Decisions

- Widen `isTestFileReference` beyond JS conventions to recognize common test-file spellings across ecosystems: at minimum `*Tests?.{swift,m,kt,java}`, `*_test.{go,py,rb,ex,exs}`, `test_*.py`, `*_spec.rb`, keeping the existing JS `.test.` forms. A canonical Swift `*Tests.swift` keystone bullet must select and satisfy. Rules out per-project test-pattern config for now (out of scope — the fixed set covers the operator's dogfood languages; revisit only if a repo's convention falls outside it).
- The unsatisfiable-keystone rejection message must state *why* the reference is unselectable — that its filename does not match a recognized test-file pattern — rather than echoing the canonical-looking bullet alone. Rules out leaving the operator to source-dive.
- Keep the early rejection behavior itself (refusing silent dead evidence is correct); only widen recognition and improve the message. Rules out dropping the guard.
- Downstream `@mutate` verification still assumes the JS toolchain; this seed does not make Swift mutation verification *work*, only stops the *plan validator* from systematically rejecting non-JS keystones. Rules out scope creep into the mutation-runner. (If broader, the alternative — plan-draft guidance omitting keystone bullets when the project has no `package.json` — may be tracked separately; not required by this seed.)

## Acceptance criteria

- [ ] `isTestFileReference` returns true for `ChessPracticeTests/RootContentTests.swift`, `foo_test.go`, `test_foo.py`, `foo_spec.rb`, `FooKtTest.kt` (and equivalents) while still true for existing `foo.test.ts`/`.test.` forms and false for a plain non-test path — pinned by a unit test enumerating language cases (fails against the current JS-only regex).
- [ ] A plan subspec with a canonical Swift keystone bullet naming `ChessPracticeTests/RootContentTests.swift` is selected by `selectKeystoneCheckpointCriteria` and is NOT returned by `findUnsatisfiableKeystoneCriteria` — pinned by a test (fails today).
- [ ] The `contract_miss` message for a genuinely unsatisfiable keystone (a bullet whose named file matches no recognized test-file pattern) names that the filename does not match a recognized test-file pattern — pinned by a test asserting the message text.
- [ ] `bun run typecheck` and `bun run test:v2` pass (shared surface → also `test:integration:v2`).

## Documentation updates

- `v2/docs/test-writing.md` — keystone/mutation checkpoint section: recognized test-file patterns are language-neutral; list the accepted spellings.
