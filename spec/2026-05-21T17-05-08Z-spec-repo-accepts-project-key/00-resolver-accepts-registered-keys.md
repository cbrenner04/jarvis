# Resolver accepts registered project keys from spec `repo:`

## Problem

`jarvis plan` against a registered project with no configured `origin` (typical for non-git directories, or for git directories where `jarvis init` did not capture the origin) writes a `repo:` line into the generated `index.md` using `project.key` as the fallback. See `injectRepoLineIntoIndex` in `src/commands/plan.ts:2402` (`const repoValue = project.origin ?? project.key;` at line 2419).

`resolveProject` in `src/resolve-project.ts` does not accept a bare key on the spec `repo:` path. The current spec-repo block (lines 67-111) handles the value as either an absolute path (line 69) or a URL/slug fed to `normalizeRepoUrl` (line 84). A bare token like `genomics-stream` has no `/`, so `normalizeRepoUrl` returns `undefined` and the resolver returns `kind: "error"` with the bare message at line 88:

```text
unrecognized `repo:` value: genomics-stream
```

The `--repo` flag does not have this gap: `resolveFromFlag` matches a registered key by name first (line 166) before trying absolute-path or URL/slug. Plan mode is therefore writing values that `jarvis run` cannot read back. This subspec brings the spec `repo:` path to parity with `--repo` for the registered-key case and reuses the helpful "Registered projects: …" error on the bare-message failure path.

Reproduction (with the existing failing spec):

```sh
jarvis run ~/.jarvis/specs/genomics-stream/lab-systems-testing-evidence-scanner/index.md
# → unrecognized `repo:` value: genomics-stream
```

## Decisions

- **Precedence inside the spec-repo block (`src/resolve-project.ts:67-111`):** registered-key match runs **first**, before the `isAbsolute` branch (line 69) and before the URL/slug `else` branch (line 83). Mirrors `resolveFromFlag`'s order (name beats path beats URL) and prevents a key from being mistaken for an absolute path.
- **Returned shape on key match:** `{ kind: "ok", resolved: { project: byName, mode: "registered", source: "spec-repo" } }`. Do **not** introduce a new `source` variant; downstream consumers of `ResolvedProject.source` (`src/resolve-project.ts:27`) should not need to learn a new case.
- **Bare-message error (line 88) is replaced with `formatUnknownRepoError`.** When the key check misses and `normalizeRepoUrl` returns `undefined`, return `kind: "error"` whose message is rendered by `formatUnknownRepoError` so the user sees the registered-keys list. This is also the only error path on Step 2 today; the no-matches branch at the `else` end (line 109 comment) continues to fall through to Steps 3-5 and is **not** converted into an error.
- **`formatUnknownRepoError` is generalized, not duplicated.** Its current body (line 216, with the literal `--repo` embedded at line 225 as `\`--repo: no project matches ${JSON.stringify(value)}\``) embeds `--repo` literally. Add an optional parameter `leadIn?: string` defaulting to `"--repo"` so the two existing `--repo` call sites (`src/resolve-project.ts:186` and `:213`) keep byte-identical output. The new spec-repo call site passes the literal string `"spec \`repo:\`"` (so the rendered error opens with `` spec `repo:`: no project matches "genomics-stream" ``). Do not inline a wrapper that rewrites the first line; do not fork the body.
- **Ambiguous-matches branch is unchanged.** The URL/slug `else` already returns `kind: "ambiguous"` when `matches.length > 1` (lines 102-107). The new key check sits above this branch and does not affect it.
- **Absolute-path branch is unchanged.** Legacy `repo: <absolute-local-path>` exact-root matching at lines 69-82 is not touched. Do not add a key check inside it.
- **Slug-shaped key precedence:** if a user registers a project whose `key` happens to look like an `owner/repo` slug, the registered project wins (name beats URL). This is locked in by a dedicated test and matches `--repo`'s precedence.
- **Out of scope for this subspec:** changing `--repo` flag semantics; re-running `jarvis init` for any project; persisting any new config; changing what `injectRepoLineIntoIndex` writes (subspec 01 owns that surface and is explicitly non-blocking).

## Task Checklist

- [ ] In `src/resolve-project.ts`, add a registered-key match at the top of the existing `if (opts.specRepo !== undefined && opts.specRepo.trim() !== "")` block (currently starting at line 67), placed before the `isAbsolute(repoValue)` check on line 69. On match, return `{ kind: "ok", resolved: { project: byName, mode: "registered", source: "spec-repo" } }`.
- [ ] In the same file, replace the bare `unrecognized \`repo:\` value: ${repoValue}` error at line 88 with `formatUnknownRepoError(repoValue, projects, "spec \`repo:\`")`.
- [ ] Generalize `formatUnknownRepoError` (definition at line 216) to accept an optional `leadIn` parameter defaulting to `"--repo"`. Confirm the two existing `--repo` call sites (`src/resolve-project.ts:186` and `:213`) take the default and produce byte-identical output. The spec-repo call site passes `"spec \`repo:\`"`.
- [ ] Add unit tests to `test/resolve-project.test.ts`:
  1. `specRepo: "genomics-stream"` with a registered project whose key is `genomics-stream` (root set, no `origin`) → `kind: "ok"`, `resolved.source === "spec-repo"`, `resolved.mode === "registered"`, `resolved.project.key === "genomics-stream"`. Direct regression test for the reported bug.
  2. `specRepo: "not-registered"` (no slash; no matching project; URL/slug normalization fails) → `kind: "error"`; `message` contains the registered keys list and opens with the literal `` spec `repo`: `` lead-in (i.e. begins with `` spec `repo`: no project matches `` after `formatUnknownRepoError` renders it). Locks in the `formatUnknownRepoError` reuse.
  3. Slug-collision precedence: a registered project with `key: "owner/repo"` and `specRepo: "owner/repo"` (no other project's origin matches) → resolves to the registered project, `mode: "registered"`, `source: "spec-repo"` (name beats URL).
  4. `--repo` parity guard: `repoFlag: "genomics-stream"` against the same config as test (1) → `kind: "ok"`, `resolved.source === "repo-flag"`. Guards against accidentally collapsing the two paths.
  5. Fall-through guard: `specRepo: "https://github.com/owner/unregistered"` (no registered project's origin matches that URL) with a spec path located inside a registered project's root → `kind: "ok"`, `resolved.source === "registered"` (Step 3 still wins after Step 2's URL/slug yields zero matches). If an equivalent test already exists, verify it still passes; do not duplicate.
- [ ] Run `bun run typecheck` and `bun test`; confirm both pass.
- [ ] Update documentation per the "Documentation updates" section below.

## Acceptance criteria

- [x] The spec-repo block in `src/resolve-project.ts` performs `projects.find((p) => p.key === repoValue)` **before** the `isAbsolute(repoValue)` check, and returns `{ kind: "ok", resolved: { project, mode: "registered", source: "spec-repo" } }` on match.
- [x] The bare `unrecognized \`repo:\` value: …` error path is replaced with a `formatUnknownRepoError(...)` call so the user sees the registered-keys list.
- [x] `formatUnknownRepoError` accepts an optional lead-in parameter (default `"--repo"`); both existing `--repo` call sites continue to produce byte-identical error messages.
- [x] `test/resolve-project.test.ts` contains the 5 cases listed in the task checklist, all passing under `bun test`.
- [x] The no-matches URL/slug fall-through (line 109 area) is unchanged: a spec with `repo: <unmatched-url>` whose path lives inside a registered root still resolves via Step 3 rather than erroring. Locked in by test (5).
- [x] The ambiguous-matches branch (URL/slug, `matches.length > 1`) still returns `kind: "ambiguous"` rather than erroring or being short-circuited by the new key check.
- [x] A registered project whose key happens to look like an `owner/repo` slug resolves to that registered project, not via URL matching. Locked in by test (3).
- [x] `--repo` behavior is unchanged. Locked in by test (4).
- [x] `bun run typecheck` passes after the change.
- [x] `bun test` passes after the change.

## Documentation updates

`docs/spec-guidance.md` and `docs/run-loop.md` do not currently document sub-steps within Step 2; both files describe Step 2 as a single "Spec `repo:` URL/slug" item in the top-level 1-5 resolution order list. Do not invent a new sub-list; instead, surface the new accepted form and rephrase Step 2 so the key-match path is visible.

- [x] **`docs/spec-guidance.md`:**
  - [x] Under the "Accepted forms" list (currently at line 71-73: HTTPS URL / SSH URL / Slug), add a fourth bullet for "Registered project key" with a parenthetical note that it is **local-only and not portable across machines** because keys are defined in `~/.jarvis/config.json`. Recommend URL/slug for portable specs.
  - [x] In the resolution-order list (the "1." through "5." block starting at line 78), rephrase item 2 so it covers both the registered-key match and the URL/slug loose match (e.g. "Spec `repo:` matches a registered project's key, or URL/slug loose-matched against a registered project's `origin`."). Do not introduce a sub-numbered list; a single sentence covering both forms is sufficient.
- [x] **`docs/run-loop.md`:** mirror the same change to item 2 of the 1-5 list at lines 12-23. Same single-sentence treatment as `docs/spec-guidance.md`; do not introduce a sub-list.
- [x] **`README.md`:** the Spec Shape section (around line 98) uses a URL example and does not currently enumerate accepted `repo:` forms. Leave the example unchanged. If a `grep -n "repo:" README.md` surfaces any prose that enumerates the accepted forms (i.e. URL / slug, etc.), update it to include the registered-key form with the same local-only caveat; otherwise no README change is required.
