# Ignore an unresolvable `repo:` line when the spec location resolves

## Problem

`jarvis run` hard-aborts when an `index.md` carries a `repo:` line it cannot
resolve. The aborting inputs are a **relative slash path** (`./project`,
`a/b/c`) and a **non-slug bareword** (`jarvis`). URL and `owner/repo` slug
forms do *not* abort today — they pass the guard and, when no origin matches,
fall through silently; this spec's own `index.md` URL line is runnable proof.

Two abort sites:

- `resolveProjectFromSpec` (`v1/src/modes/shared-entry.ts`) rejects a relative
  slash value up front with `spec repo must be an absolute path: …` before
  `resolveProject` runs. The guard fires only for values containing a slash
  that are neither absolute nor URL/slug, so `./project` and `a/b/c` abort here
  but the bareword `jarvis` slips past it.
- `resolveProject` (`v1/src/resolve-project.ts`) returns `kind: "error"` when
  the `repo:` value normalizes to nothing — `normalizeRepoUrl` returns
  `undefined` (non-slug bareword like `jarvis`, multi-slash junk) — emitting the
  unknown-repo error before location-based steps 3/4 are tried. A slug with no
  matching origin does **not** hit this; it already falls through.

A merged, otherwise-valid in-repo spec — whose path already sits inside the
target checkout — becomes un-runnable until the line is hand-stripped (PR #522).

## Behavior

When a spec's `repo:` value is unresolvable, run resolution proceeds to the
normal location-based steps (spec inside a registered project root, then ad-hoc
git-checkout walk). If either resolves, the target is used and the `repo:` line
is ignored. The hard error is emitted only when no location-based source
resolves.

Removing the `shared-entry.ts` guard deletes the `spec repo must be an absolute
path` string entirely. In the no-fallback case the surviving message is
`resolveProject`'s existing unknown-repo resolution error
(`spec \`repo:\`: no project matches "<value>"` followed by the registered
projects list) — informative, naming the unresolved value and the registered
projects.

"Unresolvable" covers: a relative slash path (`./project`, `a/b/c`) and a
non-slug bareword (`jarvis`). Legitimate resolution is unchanged: `--repo`,
registered-key `repo:`, matching URL/slug `repo:`, ambiguous matches, and legacy
absolute-path `repo:` exact-root matches all behave as today.

## Decisions

- Unresolvable `repo:` falls through to location-based resolution instead of
  aborting up front; rules out keeping the hard-abort or stripping the line.
- The fall-through defers (does not discard) the resolution failure: when steps
  3/4 also fail, `resolveProject`'s unknown-repo error is surfaced — not a
  generic prompt — so no-fallback specs keep an informative message. The
  pre-existing `spec repo must be an absolute path` string is removed, not
  preserved; rules out re-emitting a now-dead message.
- Both tasks are required and ordered: relaxing the `shared-entry.ts` guard
  alone is inert — a relative path still fails `normalizeRepoUrl` and hits the
  `resolveProject` error. The fall-through in `resolveProject` (try steps 3/4
  before erroring) is what tolerates the line. Rules out a guard-relaxation-only
  fix that merely relocates the abort.
- A present-but-unresolvable `repo:` (including a typo'd registered key) is
  silently ignored whenever the location resolves: the run proceeds against the
  location-based target with `source: "registered"`/`"ad-hoc"` rather than
  surfacing today's "no project matches…" list. Rules out erroring whenever a
  `repo:` is present but unresolvable; accepted as aligned with the intent
  ("tolerate the line").

## Task checklist

- [ ] Make `resolveProject` try steps 3/4 before emitting the unknown-`repo:`
  error; surface that error only when no location source resolves.
- [ ] Remove the up-front relative-`repo:` reject in `shared-entry.ts` (deletes
  the `spec repo must be an absolute path` string).
- [ ] Add tests for the new fall-through (registered + ad-hoc, relative-path and
  bareword) and the no-fallback error path; update the `run.test.ts`
  relative-repo test to assert the surviving unknown-repo message.
- [ ] Update docs (run-loop.md, spec-guidance.md, v2/docs/v1-behaviors.md).

## Acceptance criteria

- [ ] A spec inside a registered project whose `repo:` line is a relative slash
  path (`./project`) resolves to that registered project (`source:
  "registered"`) and runs, instead of aborting with `spec repo must be an
  absolute path`.
- [ ] A spec inside a registered project whose `repo:` line is a non-slug
  bareword (`jarvis`) resolves to that registered project (`source:
  "registered"`) and runs, instead of aborting with the unknown-repo error.
- [ ] A spec inside a non-registered git checkout with a relative-path or
  bareword `repo:` line resolves in ad-hoc mode (`source: "ad-hoc"`).
- [ ] `resolve-project.test.ts` "unknown key errors with registered projects
  list" stays green — an unresolvable `repo:` with no location fallback still
  returns the informative resolution error.
- [ ] `resolve-project.test.ts` URL fall-through, legacy absolute-path, key/slug,
  ambiguous, and `--repo` tests stay green (legitimate resolution unchanged).
- [ ] A spec with a relative `repo:` line that is not inside any registered
  project or git checkout still exits 1 before any agent runs, emitting the
  unknown-repo resolution error (`no project matches "<value>"`) rather than the
  removed `spec repo must be an absolute path` string (`run.test.ts`).
- [ ] `run.test.ts` spec-`repo:` source-attribution and `--repo` tests stay green.

## Documentation updates

- [ ] `v1/docs/run-loop.md` Iteration resolution section documents that an
  unresolvable `repo:` line is ignored when the spec location resolves, with the
  hard error reserved for the no-fallback case.
- [ ] `v1/docs/spec-guidance.md` resolution-order section reflects the same.
- [ ] `v2/docs/v1-behaviors.md` records the changed resolution behavior.
