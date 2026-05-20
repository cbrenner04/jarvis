# 00 - Preserve project fields on harness writes

## Problem

`setProjectGit` (src/config.ts:709-728) and `registerProject` (src/config.ts:665-687) rebuild the project object from a hand-picked subset of fields. Both functions drop `plan` and `siblings` on every write. Concretely:

- `setProjectGit` constructs `next: Project = { root: project.root }`, then conditionally copies `origin` and `git`. `plan` and `siblings` are never copied. The next `writeConfig` persists a project record that is missing those fields.
- `registerProject` constructs `project: Project = { root }`, then conditionally adds `origin`. If the project is already registered with `plan`, `siblings`, or a `git` override, all of those are silently lost when `jarvis init` runs again on the same root.

There is no test covering field preservation across these mutators, so the bug has been latent.

## Scope and decisions

- The fix is in `src/config.ts` only. No new public API, no schema change.
- `setProjectGit` must preserve every field on the existing `Project` (`origin`, `siblings`, `plan`) and only mutate `git` (set or remove). When `value === undefined` the `git` key must be removed from the project record entirely, not stored as `undefined`.
- `registerProject` must preserve every field on an existing project record (`origin`, `git`, `siblings`, `plan`) when re-registering the same project name. `root` is always overwritten with the new value. `origin` is overwritten only when the caller supplied a non-empty `origin`; otherwise the existing `origin` is preserved.
- For a brand-new project (name not yet registered), `registerProject` keeps its current behavior: emit a record with `root` and, if supplied, `origin`. No other fields exist to preserve.
- Both functions continue to call `writeConfig`, which runs `validateConfig` on the round-trip. Field preservation must keep the resulting config valid (e.g., `siblings` arrays still pass the absolute-path check; the existing values came from `validateConfig` on load, so this is satisfied by construction).
- Do not introduce a generic project-merge helper unless both mutators share enough logic to make a helper smaller than the call sites. Keep the change minimal.
- No changes to `setProjectOrigin` (already uses `{ ...project, origin }`, which preserves fields). Add a regression test for it anyway to lock the behavior in.

## Task Checklist

- [ ] Rewrite `setProjectGit` to spread the existing project and mutate only the `git` key. When `value === undefined`, ensure the `git` key is absent from the persisted record.
- [ ] Rewrite `registerProject` to load the existing project (if any), preserve its fields, overwrite `root`, and apply `origin` only when the caller supplied a non-empty origin.
- [ ] Add tests covering field preservation for `setProjectGit`, `registerProject` re-registration, and `setProjectOrigin`.
- [ ] Verify behavior end-to-end by writing a config with `plan` and `siblings`, calling each mutator, reloading via `loadConfig`, and asserting both keys survive.

## Acceptance criteria

- [ ] `setProjectGit(name, true | false | undefined)` preserves `origin`, `siblings`, and `plan` on the existing project record across a write+reload round trip.
- [ ] `setProjectGit(name, undefined)` removes the `git` key from the persisted record (not stored as `undefined`, not left as the previous value).
- [ ] `registerProject(name, root)` on a name that is already registered preserves `origin`, `git`, `siblings`, and `plan`; only `root` is overwritten.
- [ ] `registerProject(name, root, { origin })` on a name that is already registered preserves `git`, `siblings`, and `plan`; both `root` and `origin` are overwritten.
- [ ] `registerProject(name, root)` on a brand-new name still writes a record with only `root` (and `origin` if supplied), unchanged from current behavior.
- [ ] `setProjectOrigin(name, origin)` preserves `git`, `siblings`, and `plan` (locked in by regression test even though current code already does this via spread).
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- No README or docs/ changes required; the documented schema and CLI surface do not change. Project field preservation is implicit in the schema and was previously expected behavior that the tests did not enforce.
- If the existing `docs/config.md` mentions `setProjectGit` or `jarvis init` re-registration, confirm wording is consistent with "existing project fields are preserved" without overstating new guarantees. No new content required unless the doc currently contradicts the fix.
