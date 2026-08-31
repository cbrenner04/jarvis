# Admit external plan spec paths

`resolveImplementSpecIdentity` refuses every spec outside registered project roots, so plan output at `~/.jarvis/specs/<project-safe-id>/plans/<name>/index.md` cannot launch implement even though `planSource` already published it there.

## Decisions

- Admit a canonical `index.md` only when it resolves under `join(jarvisHome(), "specs", projectSafeId(registered-key), "plans", …)` for exactly one registered owner whose `planSource` external-publication predicate is true (`config.git === false || (config.plan?.commit ?? true) === false`); rules out `modes.plan.commit` precedence, arbitrary external paths, and multi-project ownership guesses.
- Derive the owning project by scanning registered keys for a matching `projectSafeId` segment under `specs/<safeId>/plans/`, not by longest-prefix match against repository roots; rules out reusing `findProjectMatch` alone on external paths.
- Refuse admission when two registered keys share the same `projectSafeId` and both could match the external path; rules out guessing an owner.
- Add `externalPlanSpec: true` and `specReadRoot` (the containing `plans/<name>/` directory) to `ImplementSpecIdentity`; preserve the operator canonical path in `absoluteSpecPath` and set `project`/`projectRoot` from the owning registered project; keep `specPath` as the project-relative anchor only — completeness, recovery, launch rewrite, write-step `specPath`, and stale-reset consume `absoluteSpecPath` and/or `specReadRoot` per `01`–`03`, not repo-relative `identity.specPath`; rules out copying or relativizing the spec tree into the repository.
- Reject symlink escapes under `~/.jarvis/specs/...` with the same realpath containment posture as in-repo admission; rules out weakening existing containment tests.
- Keep in-repo spec/artifact containment, non-index `--artifact` requirements, and non-external admission unchanged; rules out broadening positive admission beyond external plan `index.md`.

## Tasks

- Extend `ImplementSpecIdentity` with `externalPlanSpec` and `specReadRoot` plus the path-consumption contract above.
- Add an external-plan matcher in `resolveImplementSpecIdentity` (or a dedicated helper it calls) that validates `jarvisHome()/specs/<safeId>/plans/**` layout, resolves the owning registered key, applies the `planSource` external-publication predicate, and refuses ambiguous `projectSafeId` collisions.
- Return the existing `Spec path outside registered project roots` error for disallowed external paths so current CLI tests remain the reachable pre-fix refusal.
- Add regression and rejection coverage in `implement-workflow-steps.test.ts` and preserve in-repo symlink containment in `workflow.test.ts`.

## Acceptance criteria

- [ ] `implement-workflow-steps.test.ts` admits `--spec` at `~/.jarvis/specs/<safeId>/plans/<name>/index.md` for a registered project whose `planSource` publishes externally (including `git: false` with default `plan.commit`), resolves the owning project, sets `externalPlanSpec`/`specReadRoot`, and preserves the canonical external absolute path in `absoluteSpecPath`; it fails against the current `Spec path outside registered project roots` refusal from `resolveImplementSpecIdentity`.
- [ ] `implement-workflow-steps.test.ts` rejects unregistered safe IDs, paths outside `plans/`, owners whose `planSource` would publish in-repo only, external subspec file paths, plan directories without `index.md`, two registered keys sharing the same `projectSafeId`, and symlink escapes under `~/.jarvis/specs/<safeId>/plans/...`; it fails against the pre-fix admission path.
- [ ] `workflow.test.ts` `run workflow implement rejects escaping spec and artifact symlinks before builder or daemon contact` stays green (in-repo containment unchanged).

## Documentation updates

- `v2/docs/workflow-runner.md` — add an external-plan implement admission subsection covering ownership resolution, the `planSource` publication predicate, allowed `index.md` path shape, identity fields, and canonical absolute path retention; state that this spec's contract ends at admission (cross-link execution routing in a sibling intent); defer base-ref bypass, completeness, and stale-reset detail to later subspecs.
