---
name: multi-repo-siblings-and-blocker-fix
---

Multi-repo support: let a project declare sibling repos the agent may edit, and surface the silent commit-blocker error path that hides why a blocker commit failed.

# Context

First real multi-repo run uncovered two issues. The project layout is:

    ~/Work/groceries/
      groceries_features/   (Ruby feature/spec runner — where jarvis specs live, where the worktree is created)
      groceries-client/     (React app — most fixes need to land here)
      groceries-service/    (Rails API)
      AGENTS.md             (shared multi-repo guide)

Run that exposed both bugs:

    $ jarvis run groceries_features/spec/2026-05-17T21-05-08Z-fix-list-delete-and-merge-failures/index.md

The agent correctly identified that the fix for cluster A had to be applied to `groceries-client/src/components/domain/ListCard.tsx`, but it has no write (or read) access to that directory from inside the `groceries_features` worktree. It parked a blocker asking the user to grant access. On a later iteration, attempting to commit the (re-emitted) blocker failed with no useful detail:

    failed to commit blocker for .../01-fix-cluster-a-confirm-dialog.md: Command failed: git commit -F -

# Issue 1: no way to declare sibling repos in a multi-repo project

## Where the access boundary is set today

- `src/agents/claude.ts:60-63` builds claude argv as `["-p", "--permission-mode", "acceptEdits"]` and then appends `--add-dir <dir>` for every entry in `opts.additionalReadDirs`. Important: with `--permission-mode acceptEdits`, `--add-dir` actually grants both read and write access to that directory — the field name is misleading.
- `src/modes/patch/run.ts:418-421` is the only producer of `additionalReadDirs`:
      const additionalReadDirs = specOutsideWorktreeReadDirs({ specPath, agentWorkingDir });
- `specOutsideWorktreeReadDirs` (`src/modes/patch/run.ts:1600-1611`) returns just `dirname(specPath)` when the spec sits outside the worktree, otherwise `undefined`.

So the *only* directory outside the worktree the agent can touch is the spec dir. There is no concept of "this project has sibling repositories that are part of the same work."

## Where the project model lives

`Project` in `src/config.ts:75-79`:

    export type Project = {
      root: string;
      origin?: string;
      git?: boolean;
    };

Registered in `~/.jarvis/config.json` under `projects`. Validation, defaults, and round-trip handling are in `src/config.ts` (`validateConfig`, `registerProject`, `findProjectMatchForPath`, etc.). The shape is what we'd extend.

## Proposed shape

Add an optional list of sibling directories to `Project`:

    export type Project = {
      root: string;
      origin?: string;
      git?: boolean;
      siblings?: string[];   // absolute paths the agent gets --add-dir access to
    };

Name TBD — candidates: `siblings`, `additionalDirs`, `linkedRepos`. I lean toward `siblings` because in this layout they really are sibling repos under a shared parent. We're not trying to model a full monorepo graph; this is a flat allowlist of paths to expose to the agent.

In `prepareRun` (`src/modes/patch/run.ts` around 418), concat the project's siblings onto `additionalReadDirs` before returning. Resolution rules:

- Entries must be absolute paths (mirror the `root` validation).
- Entries must exist at run time; if a sibling has been deleted/moved, fail fast with a clear error rather than silently dropping it.
- De-dup against the spec-derived entry and the worktree path itself.

Validation in `src/config.ts` mirrors how `root` is checked. No migration needed because the field is optional and absent configs behave as today.

## Things to think through, not decisions

- Should siblings be per-project only, or also settable globally? Per-project is simpler and matches how this layout works; defer global.
- Do we want to record *what kind* of access (read vs read-write)? Today the underlying `--add-dir` is read-write under acceptEdits, so a separate read-only mode would need a different mechanism (different permission mode or per-dir scoping that claude doesn't currently expose). Out of scope unless we hit a concrete need.
- Other agents (`codex`, `cursor`, `opencode`, `aider`) — does `additionalReadDirs` propagate to them, and what's the equivalent flag for each? Audit `src/agents/*.ts` and either wire each one or document that multi-repo is claude-only for now. Don't silently drop the dirs for non-claude agents.
- Worktree creation: today only the project root gets a worktree (`src/worktree.ts`). With siblings, the agent is editing live sibling repos directly — no isolation, branches advance in place. Is that what we want? For the immediate need yes; longer term we may want per-sibling worktrees, but that's a much bigger change.
- AGENTS.md: the user's multi-repo guide (`~/Work/groceries/AGENTS.md`) explicitly tells the agent not to operate across multiple repositories in a single step. Granting access doesn't change that guidance; it just unblocks the agent when the spec legitimately needs cross-repo edits. Worth a note in jarvis docs (not in this change) that sibling access is opt-in per project.
- Config UX: a `jarvis config project <name> --add-sibling <path>` command would be nicer than hand-editing JSON. Plumb through `src/commands/config.ts` if cheap; otherwise document the JSON shape and defer the CLI.

# Issue 2: blocker-commit failure swallows the real git error

## Where the error is lost

- `commitWipProgressWithBlocker` in `src/modes/patch/subspec.ts:101-146` calls:
      execFileSync("git", ["commit", "-F", "-"], { cwd, stdio: ["pipe", "pipe", "pipe"], input: commitMessage });
- On failure, the thrown error's `.message` is just `Command failed: git commit -F -`. Real stderr lives on `err.stderr` but is never read.
- `src/modes/patch/run.ts:1059-1067` catches it and emits `failed to commit blocker for ${path}: ${err.message}` — that's what the user saw. No git output.

## Likely root cause in this run

Git log on the worktree shows two blocker WIPs already committed (`74e0514`, `71af3ae`) and a clean working tree. The agent re-emitted essentially the same blocker text on a later iteration, so `git add -A` staged nothing and `git commit` aborted with "nothing to commit." The detection logic at `src/modes/patch/run.ts:1041` (`hasBlockerNow && !hasBlockerBefore`) does gate on a new blocker appearing, but it's looking at the *parsed spec content* per iteration — if the agent rewrites the same blocker fresh each loop, the harness keeps thinking it's "new."

## Proposed shape

Two small fixes, independent:

1. **Surface the real git error.** In `subspec.ts`, both `commitSubspec` and `commitWipProgressWithBlocker`: catch the execFileSync throw, append `err.stderr?.toString()` (and `err.stdout` if non-empty) to the thrown message, then re-throw. Apply to anywhere we shell out to git in this module — `commitSubspec` at line 93 has the same blind spot.

2. **No-op when there's nothing to commit.** Before `git commit`, run `git diff --cached --quiet` (exit 0 = clean, 1 = has staged changes). If clean, skip the commit but still let the caller proceed to the "emit blocker text + return exitCode 7" path. The blocker is already in HEAD from a prior iteration; that's fine, the user just needs to see the blocker surfaced.

   Open question: do we also want to detect "this blocker is identical to the one in the last commit" to avoid even attempting? Probably not — the `git diff --cached --quiet` check catches it naturally and is simpler than diffing blocker bodies.

## Things to think through, not decisions

- Should the "blocker repeated" case also short-circuit the iteration earlier (don't re-run the agent if the same blocker is still active and we have no signal it's resolved)? That's a separate behavior question. Today the harness re-runs because it has no notion of "blocker is still blocking"; the spec contract is that the user removes the blocker section to unblock. Worth tracking separately.
- `hasBlockerBefore` vs "blocker text unchanged from HEAD": consider whether the iteration loop should treat a blocker that exists *and equals* the prior committed blocker as a no-progress signal and exit, rather than spinning. Out of scope here, but related.

# Files most likely to touch

- `src/config.ts` — extend `Project` type, validate `siblings` array.
- `src/modes/patch/run.ts` — merge project siblings into `additionalReadDirs` in `prepareRun`; possibly tighten blocker re-emit handling around line 1041.
- `src/modes/patch/subspec.ts` — surface stderr from `execFileSync` failures; skip empty commits.
- `src/agents/claude.ts` — likely no change (already consumes `additionalReadDirs`); confirm.
- `src/agents/{codex,cursor,opencode,aider}.ts` — audit whether `additionalReadDirs` is honored.
- `src/commands/config.ts` — optional sibling-management subcommand.

# Out of scope

- Per-sibling worktrees or branch isolation across repos.
- A general dependency graph between repos.
- Anything in the groceries repos themselves — the fix demonstrated by the failing run lives in `groceries-client`, not here.

## Interview turn 1

Code audit findings that sharpen the two implementation areas:

### Issue 1 — siblings: confirmed call sites and agent audit

`additionalReadDirs` is defined in `src/agents/types.ts:30` as optional on `AgentRunOptions`. Only `src/agents/claude.ts` reads it (line 61: iterates and appends `--add-dir <dir>`). The other four agent files — `aider.ts`, `codex.ts`, `cursor.ts`, `opencode.ts` — do not reference `additionalReadDirs` at all. Multi-repo sibling access is therefore claude-only in practice.

**Recommended handling for non-claude agents:** Rather than wiring siblings into agents with fundamentally different sandbox/permission models (codex uses `--sandbox workspace-write`, aider uses `--yes-always` with no equivalent flag), emit a run-time warning when the active agent is not claude and siblings are configured. Do not silently drop the dirs and do not abort — warn and continue. This is consistent with how other unsupported flags degrade gracefully.

**Merge point:** `prepareRun` in `src/modes/patch/run.ts` at line 418 builds `additionalReadDirs` via `specOutsideWorktreeReadDirs`. Project is available in scope there (`project` from the surrounding `PreflightOk` assembly). Concat project siblings after the spec-dir entry, then de-dup with a `Set` before returning. Siblings existence check belongs here (after config load, at run time), using `existsSync` — consistent with how the worktree path is checked elsewhere in `prepareRun`.

**Validation in `src/config.ts`:** The pattern is established at lines 313–358. Each sibling entry mirrors `root` validation: must be a string, must be absolute path (`isAbsolute`). No need for a duplicate-root-style cross-check (siblings are not project roots). Add validation after `gitRaw` at line 351.

### Issue 2 — blocker commit: exact fix points and implementation details

**Surface stderr:** Both `commitSubspec` (line 93) and `commitWipProgressWithBlocker` (line 140) call `execFileSync("git", ["commit", "-F", "-"], { stdio: ["pipe", "pipe", "pipe"] })`. The `stdio` option without `encoding` means `.stderr` and `.stdout` on the thrown error are `Buffer`. Wrap each call: catch the thrown error, check `'stderr' in err`, append `err.stderr?.toString()` (and `.stdout` if non-empty) to a rethrown message. Apply the same pattern to `getGitRoot` (~line 150) which already catches but only uses `.message`.

**Skip empty commit:** In `commitWipProgressWithBlocker`, after `git add -A` (line 118) but before `git commit` (line 140), check for staged changes using `spawnSync` (not `execFileSync`) to avoid the throw-on-nonzero issue: `spawnSync("git", ["diff", "--cached", "--quiet"], { cwd, stdio: "pipe" })`. Exit status 0 means nothing staged — return early without committing. The caller in `run.ts` (line 1051 call site) proceeds to emit the blocker text and return exit code 7 regardless; skipping the git commit when there is nothing new to stage is correct behavior. `commitSubspec` does not need this guard — a normal subspec commit with no staged changes would be a harness bug, not a retry scenario, so let it surface loudly there.

**`hasBlockerNow && !hasBlockerBefore` gate:** The intent's analysis is correct. The gate at `run.ts:1041` fires when the spec transitions from no-blocker to has-blocker within a single iteration. If the agent removes and re-writes the same blocker text in the same iteration (which is what happened), the net effect is `hasBlockerBefore=false, hasBlockerNow=true` → the commit IS attempted → `git add -A` stages nothing (the blocker content is identical to what's in HEAD) → `git commit` fails with "nothing to commit." The `git diff --cached --quiet` guard in `commitWipProgressWithBlocker` closes this loop cleanly.

### Subspec decomposition suggestion

These two issues are independent and touch disjoint files. They can ship as separate subspecs: one for Issue 2 (small, low risk, no config schema change) and one for Issue 1 (config schema + run.ts plumbing + agent warning). Suggest ordering Issue 2 first so the improved error surface is available during Issue 1 development if siblings work surfaces a new git-adjacent failure.

## Interview turn 2

Code audit clarifications that close the remaining implementation gaps before drafting:

### Issue 1 — siblings: accessing siblings at the merge point

`PreflightOk.project` is typed as `ProjectMatch` (`{ key: string; root: string; origin?: string }`), not the full `Project`. `ProjectMatch` intentionally does not carry `siblings` — do not add it there. Instead, at the merge point (line 418 in `run.ts`), access siblings via `cfg.projects[project.key]?.siblings`. Both `cfg` and `project` are in scope at that line (confirmed: `cfg` is used at line 389 for `worktreeSymlinks`, `project.root` is used at line 387 for `ensureWorktree`).

The `specOutsideWorktreeReadDirs` function returns `string[] | undefined`. When merging siblings in, flatten to a single `string[]` and de-dup using `[...new Set([...specDirs, ...sibs])]`. Return `undefined` only when both lists are empty (matches the current return contract).

**Existence check placement:** The intent proposes checking siblings existence in `prepareRun`. Confirm: `existsSync` is already imported at the top of `run.ts` (confirmed by the `existsSync(siblingIndex)` call at line 427), so no new import needed there.

**Agent support update:** Do not implement siblings as a Claude-only feature with a warning for other agents. The specs now require shared run-loop forwarding plus explicit support work for every patch agent (`claude`, `codex`, `cursor`, `opencode`, and `aider`). If an agent cannot safely support sibling edits, its agent-specific subspec must record a blocker rather than silently continuing without access.

### Issue 2 — blocker commit: import and error-extraction details

**`spawnSync` import:** `subspec.ts` imports only `execFileSync` from `node:child_process` (line 1). The `git diff --cached --quiet` check needs `spawnSync` — add it to that import statement. This is the only change needed in the import block.

**Error extraction pattern:** `execFileSync` on failure throws a `ChildProcess`-flavored `Error` with `.stderr` and `.stdout` typed as `string | Buffer` depending on the `encoding` option. Because these calls omit `encoding`, the fields are `Buffer | null`. Safe extraction: `Buffer.isBuffer(err.stderr) ? err.stderr.toString() : ""`. Apply to both `commitSubspec` (line 46) and `commitWipProgressWithBlocker` (line 140) and the `commitWipProgress` function (line 93 — same blind spot, same fix). `getGitRoot` already catches and rethrows but uses `err.message` only; its thrown error is harmless since it doesn't shell-wrap a commit, so lower priority — include it for completeness.

**`git diff --cached --quiet` exit code semantics:** Exit 0 = index clean (nothing staged); exit 1 = index dirty (staged changes exist); any other exit code = git error. The guard should: if `status === 0`, return without committing (existing blocker commit in HEAD, caller continues normally); if `status === 1`, proceed to `git commit`; if `status` is `null` (signal kill) or `> 1`, throw a descriptive error rather than silently skipping. This avoids masking real git failures.

**`commitWipProgress` (non-blocker):** Same `execFileSync` stderr blind spot at line 93. The intent says to fix both `commitSubspec` and `commitWipProgressWithBlocker`; `commitWipProgress` should be included in the same fix pass since it's structurally identical.

### Subspec file naming

Updated decomposition: five subspecs.
- `00-blocker-commit-error-surface.md` — Issue 2 fixes (`subspec.ts` only, plus `run.ts` catch-site message improvement).
- `01-project-siblings-config-and-plumbing.md` — shared Issue 1 config, validation, run-loop forwarding, prompt visibility, and docs.
- `02-claude-and-codex-sibling-access.md` — `--add-dir` support for both agents.
- `03-cursor-and-opencode-sibling-access.md` — verified sibling behavior for Cursor and Opencode without unsafe bypass flags.
- `04-aider-sibling-access.md` — verified sibling behavior for Aider while preserving Jarvis-owned commits.

`src/commands/config.ts` sibling-management CLI is explicitly out of scope per the intent.

## Interview turn 3

Final code verification pass before drafting. No blockers; a few precision corrections to earlier notes.

### Corrected function name

The merge point described as `prepareRun` in the intent is the function `resolveModeSpecificPreflight` in `run.ts` (line 320). Signature: `async function resolveModeSpecificPreflight(opts, initialSpecPath, project, projectMode, cfg)`. The `additionalReadDirs` const at line 418 is declared inside this function. Draft agent: change the `const` to `let` (or produce a new merged const) to accommodate the siblings append.

### `additionalReadDirs` is a `const` at line 418

The current declaration is `const additionalReadDirs = specOutsideWorktreeReadDirs(...)`. Merging siblings requires computing the final value in one expression or declaring it `let` and reassigning. Preferred approach: compute the merged result inline and keep one `const`:

```ts
const specDirs = specOutsideWorktreeReadDirs({ specPath, agentWorkingDir });
const projectSiblings = cfg.projects[project.key]?.siblings ?? [];
// existence-check each sibling here, throw on missing
const additionalReadDirs =
  specDirs !== undefined || projectSiblings.length > 0
    ? [...new Set([...(specDirs ?? []), ...projectSiblings])]
    : undefined;
```

This preserves the existing `undefined`-means-none contract.

### Non-claude agent warning placement

`resolveModeSpecificPreflight` does not have the active agent identity — agent selection via `buildActiveAgents` happens at line 249, after this function returns. The warning cannot be emitted from inside `resolveModeSpecificPreflight`.

Recommended placement: emit the warning inside the run-loop's per-iteration agent dispatch, where the concrete `Agent` object is in scope. When siblings are non-empty (`additionalReadDirs` includes sibling paths) and the running agent is not claude, emit via `opts.io.stderr(...)` before invoking the agent. This is the correct layer because the agent identity is only known at dispatch time.

Simpler alternative (acceptable for this PR): emit the warning inside `resolveModeSpecificPreflight` unconditionally when siblings are configured, noting that non-claude agents will not have access. This fires once at run start regardless of which agent is selected — slightly imprecise but unambiguous to the user and avoids touching the iteration dispatch layer.

Draft agent: pick whichever placement is easier. The per-iteration dispatch approach is more precise; the preflight-time unconditional warning is simpler. Either is acceptable.

### `commitSubspec` git-commit line confirmed at line 46

Confirmed: line 46 in `subspec.ts` is the `execFileSync("git", ["commit", "-F", "-"])` in `commitSubspec`. The `git add -A` in `commitWipProgressWithBlocker` is at approximately line 118 (based on the code block in interview turn 1). The stderr-surfacing fix applies to both; the empty-commit guard applies only to `commitWipProgressWithBlocker`.

### run.ts catch site already uses `err.message` correctly

The catch block at `run.ts:1059-1067` already does `err instanceof Error ? err.message : String(err)`. Once `subspec.ts` appends stderr to the rethrown error's message, that detail will propagate to the user automatically — no change needed to `run.ts:1063` beyond what subspec.ts produces.
