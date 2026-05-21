# Resolver accepts registered project keys from spec `repo:`

## Problem

`jarvis plan` against a registered project with no configured `origin` (e.g. a non-git registered directory) writes a `repo:` line into the generated `index.md` using `project.key` as the fallback value (see `injectRepoLineIntoIndex` in `src/commands/plan.ts:2402`, `repoValue = project.origin ?? project.key`). The downstream resolver in `src/resolve-project.ts` does not accept a bare key on the spec `repo:` path: it tries `normalizeRepoUrl` on the value, which requires an `owner/repo` slug or a full URL, and a bare token like `genomics-stream` has no `/`, so the resolver returns `kind: "error"` with the bare message `unrecognized \`repo:\` value: genomics-stream` (currently at `src/resolve-project.ts:87-88`).

Reproduces with:

```sh
jarvis run ~/.jarvis/specs/genomics-stream/lab-systems-testing-evidence-scanner/index.md
# → unrecognized `repo:` value: genomics-stream
```

The `--repo` flag already accepts a registered key via `resolveFromFlag` (`src/resolve-project.ts:165-172`), so plan mode is currently writing values that `jarvis run` cannot read back. This subspec brings the spec `repo:` path to parity with `--repo` for the registered-key case.

## Decisions

- **Resolution precedence inside Step 2:** Registered-key match runs **first**, before the existing absolute-path branch and before the URL/slug branch. This mirrors `resolveFromFlag`'s precedence (name beats path beats URL) and ensures a key never accidentally matches an absolute path.
- **Source/mode values:** Reuse the existing `source: "spec-repo"` and `mode: "registered"` for the new key-match success case. Do not add a new `source` variant; that would force every downstream consumer of `ResolvedProject.source` to handle a new case for no benefit.
- **Error message reuse:** When the key match fails *and* `normalizeRepoUrl` returns `undefined`, switch the error path from the bare `unrecognized \`repo:\` value: ${repoValue}` to use `formatUnknownRepoError(repoValue, projects)` (defined at `src/resolve-project.ts:216`) so the user sees the registered-keys list, mirroring the `--repo` UX.
- **`formatUnknownRepoError` lead-in:** The current body embeds `--repo` literally (`--repo: no project matches ${value}\nRegistered projects:\n${list}` at line 225). Generalize it by adding an optional second parameter (a lead-in label such as `"--repo"` or `` "`repo:`" ``) defaulting to `"--repo"` so existing call sites are byte-identical. The spec-repo call site passes the spec-flavored lead-in. Do not inline a wrapper that rewrites the first line; do not duplicate the body.
- **No-matches fall-through preserved:** When `normalizeRepoUrl` succeeds but `matches.length === 0` (the implicit fall-through at `src/resolve-project.ts:109`), behavior is **unchanged** — execution still falls through to Steps 3–5 so an ad-hoc git-checkout walk can find an unregistered-but-on-disk repo. Do not convert this branch into an error.
- **Absolute-path branch unchanged:** Legacy `repo: <absolute-local-path>` handling at `src/resolve-project.ts:69-82` is not touched. Do not add a key check inside the absolute-path branch.
- **Precedence vs slug collision:** If a user registers a project whose `key` happens to be a valid `owner/repo` slug, the registered project wins (name beats URL). This matches `--repo`'s precedence and is locked in by a dedicated test.
- **Out of scope:** Changing `--repo` behavior. Re-running `jarvis init` for any project. Migrating any registered project. Changing what `injectRepoLineIntoIndex` writes (that is subspec 01, and is optional/non-blocking).

## Task Checklist

- [ ] In `src/resolve-project.ts`, inside the existing `if (opts.specRepo !== undefined && opts.specRepo.trim() !== "")` block (currently starting at line 67), add a registered-key match at the top of the block (before the `isAbsolute(repoValue)` branch). On match, return `{ kind: "ok", resolved: { project: byName, mode: "registered", source: "spec-repo" } }`.
- [ ] In the same file, replace the bare `unrecognized \`repo:\` value: ${repoValue}` error (currently at line 88) with a call to `formatUnknownRepoError(repoValue, projects, /* lead-in for spec `repo:` */)`.
- [ ] In `src/resolve-project.ts`, generalize `formatUnknownRepoError` (line 216) to accept an optional third parameter (e.g. `leadIn?: string`) defaulting to `"--repo"`. Keep existing call sites unchanged (they take the default and produce byte-identical output). The spec-repo call site passes the spec-flavored lead-in (e.g. `` "spec `repo:`" ``).
- [ ] Add 5 unit tests to `test/resolve-project.test.ts`:
  1. `specRepo: "genomics-stream"` with a registered project keyed `genomics-stream` (root set, no `origin`) → `kind: "ok"`, `resolved.source === "spec-repo"`, `resolved.mode === "registered"`, `resolved.project.key === "genomics-stream"`. This is the direct regression test for the reported bug.
  2. `specRepo: "not-registered"` (no slash; no matching project; URL/slug normalization fails) → `kind: "error"`, and `message` contains the registered keys list (mirrors `--repo`'s failure shape).
  3. Precedence test: registered project whose `key` equals a valid slug (e.g. `key: "owner/repo"`) → registered project wins over any URL/slug match.
  4. `repoFlag: "genomics-stream"` (parallel `--repo` case) → `kind: "ok"`, `resolved.source === "repo-flag"`. Guards against accidentally collapsing the two paths.
  5. Path-2 regression guard: `specRepo: "https://github.com/owner/unregistered"` (no registered project matches that origin) with a spec path that lives inside a registered project's root → `kind: "ok"`, `resolved.source === "registered"` (Step 3 still wins after Step 2's URL/slug yields no matches). If a test of this shape already exists, verify it still passes after the change; do not duplicate.
- [ ] Run `bun run typecheck` and `bun test` and confirm both pass.
- [ ] Update `docs/spec-guidance.md`:
  - Add a fourth bullet to the "Accepted forms" list under the `repo:` discussion for "Registered project key (local-only; not portable across machines)".
  - Update the resolution-order list so that Step 2's sub-order is: (a) registered-key match, (b) absolute-path exact-root match (legacy), (c) URL/slug loose match.
- [ ] Update `docs/run-loop.md`: the resolution-order section must mirror the same Step 2 sub-order change above.
- [ ] Update the `README.md` `repo:` form enumeration prose (if any). `grep README.md` for `repo:` and patch only enumeration prose; do not change the Spec Shape example (URLs remain the recommended portable form).

## Acceptance criteria

- [ ] `src/resolve-project.ts` Step 2's spec-repo block does a registered-key lookup (`projects.find((p) => p.key === repoValue)`) **before** the `isAbsolute(repoValue)` check, and on match returns `{ kind: "ok", resolved: { project, mode: "registered", source: "spec-repo" } }`.
- [ ] The previously bare `unrecognized \`repo:\` value: ${repoValue}` error path uses `formatUnknownRepoError(...)` so the user sees the registered-keys list.
- [ ] `formatUnknownRepoError` accepts a lead-in parameter (or equivalent mechanism) with `--repo` as the default; existing `--repo` call sites produce byte-identical error messages.
- [ ] `test/resolve-project.test.ts` contains the 5 cases listed in the task checklist, all passing under `bun test`.
- [ ] `bun run typecheck` passes after the change.
- [ ] `bun test` passes after the change.
- [ ] After the change, running `jarvis run` against a spec whose `index.md` contains `repo: <registered-key>` (where `<registered-key>` is a key in `~/.jarvis/config.json`) resolves to that project instead of erroring. This is demonstrable via the new unit test (1) above.
- [ ] The "no-matches fall-through" branch (Step 2 URL/slug yields zero matches) still falls through to Steps 3–5; it is **not** converted into an error. Locked in by test (5).
- [ ] A registered key whose value happens to be a valid `owner/repo` slug resolves to the registered project, not via URL matching. Locked in by test (3).
- [ ] `--repo` behavior is unchanged. Locked in by test (4).

## Documentation updates

- [ ] `docs/spec-guidance.md` — accepted-forms list and Step 2 resolution-order list updated to reflect the new registered-key match. Note that registered keys are local to one user's `~/.jarvis/config.json` and are not portable; URL/slug remain the recommended portable forms.
- [ ] `docs/run-loop.md` — Step 2 resolution-order text updated to mirror `docs/spec-guidance.md`.
- [ ] `README.md` — any enumeration of accepted `repo:` forms updated to match the docs above. Do not change the Spec Shape example.
