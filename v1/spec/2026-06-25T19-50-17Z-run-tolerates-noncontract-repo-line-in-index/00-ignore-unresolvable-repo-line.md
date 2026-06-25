# Ignore an unresolvable `repo:` line when the spec location resolves

## Problem

`jarvis run` hard-aborts when an `index.md` carries a `repo:` line it cannot
resolve. Two abort sites:

- `resolveProjectFromSpec` (`v1/src/modes/shared-entry.ts`) rejects a relative
  `repo:` value up front with `spec repo must be an absolute path: …` before
  `resolveProject` runs.
- `resolveProject` (`v1/src/resolve-project.ts`) returns `kind: "error"` for an
  unknown bareword/URL `repo:` value (`normalizeRepoUrl` undefined or no origin
  match for a bareword) before location-based steps 3/4 are tried.

A merged, otherwise-valid in-repo spec — whose path already sits inside the
target checkout — becomes un-runnable until the line is hand-stripped (PR #522).

## Behavior

When a spec's `repo:` value is unresolvable, run resolution proceeds to the
normal location-based steps (spec inside a registered project root, then ad-hoc
git-checkout walk). If either resolves, the target is used and the `repo:` line
is ignored. The hard error is emitted only when no location-based source
resolves; in that case the existing informative resolution error (naming the
unresolved value and the registered projects) is preserved.

"Unresolvable" covers: a relative path, an unknown bareword, and a URL/slug
matching no registered origin. Legitimate resolution is unchanged: `--repo`,
registered-key `repo:`, matching URL/slug `repo:`, ambiguous matches, and legacy
absolute-path `repo:` exact-root matches all behave as today.

## Decisions

- Unresolvable `repo:` falls through to location-based resolution instead of
  aborting up front; rules out keeping the hard-abort or stripping the line.
- The fall-through defers (does not discard) the resolution error: when steps
  3/4 also fail, the original unknown-repo / relative-path error is surfaced —
  not a generic prompt — so no-fallback specs keep their informative message.
- The relative-path guard in `shared-entry.ts` is removed/relaxed so relative
  values reach `resolveProject`'s deferred-error path rather than aborting
  before location resolution is attempted.

## Task checklist

- [ ] Make `resolveProject` try steps 3/4 before emitting the unknown-`repo:`
  error; surface that error only when no location source resolves.
- [ ] Remove/relax the up-front relative-`repo:` reject in `shared-entry.ts`.
- [ ] Add tests for the new fall-through (registered + ad-hoc) and the
  no-fallback error path; update the `run.test.ts` relative-repo test.
- [ ] Update docs (run-loop.md, spec-guidance.md, v2/docs/v1-behaviors.md).

## Acceptance criteria

- [ ] A spec located inside a registered project whose `repo:` line is a
  relative path (e.g. `repo: ./project`) or an unknown bareword resolves to that
  registered project (`source: "registered"`) and runs, instead of aborting with
  `spec repo must be an absolute path`.
- [ ] A spec inside a non-registered git checkout with an unresolvable `repo:`
  line resolves in ad-hoc mode (`source: "ad-hoc"`).
- [ ] `resolve-project.test.ts` "unknown key errors with registered projects
  list" stays green — an unresolvable `repo:` with no location fallback still
  returns the informative resolution error.
- [ ] `resolve-project.test.ts` URL fall-through, legacy absolute-path, key/slug,
  ambiguous, and `--repo` tests stay green (legitimate resolution unchanged).
- [ ] A spec with a relative `repo:` line that is not inside any registered
  project or git checkout still exits 1 before any agent runs (`run.test.ts`).
- [ ] `run.test.ts` spec-`repo:` source-attribution and `--repo` tests stay green.

## Documentation updates

- [ ] `v1/docs/run-loop.md` Iteration resolution section documents that an
  unresolvable `repo:` line is ignored when the spec location resolves, with the
  hard error reserved for the no-fallback case.
- [ ] `v1/docs/spec-guidance.md` resolution-order section reflects the same.
- [ ] `v2/docs/v1-behaviors.md` records the changed resolution behavior.
