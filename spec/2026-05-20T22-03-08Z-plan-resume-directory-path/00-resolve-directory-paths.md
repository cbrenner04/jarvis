# 00 - Resolve directory paths to spec files for --resume and --resume-draft

## Problem

`jarvis plan --resume` and `jarvis plan --resume-draft` require the positional
argument to be the path of a specific file inside the spec directory
(`index.md` for `--resume`, `intent.md` for `--resume-draft`). When the
operator passes the spec **directory** instead — which is the natural form,
matches what `jarvis run` accepts as `<spec-dir>/index.md` but is also how
operators think about a spec ("the May-20 clean-worktree spec") — they get a
confusing error that does not mention the directory/file mismatch at all.

Repro:

```sh
jarvis plan --resume-draft spec/2026-05-20T20-43-31Z-clean-worktree-after-pre-ready-checkfix/
# --resume-draft cannot be combined with intent text/file
```

The path is an existing directory, not an existing file. In `parsePlanArgs`
(src/commands/plan-args.ts:160), `isExistingFile(candidatePath)` returns
`false`, so the positional argument silently downgrades to
`mode: "inline"` and the string is treated as inline intent text. Later,
`runPlanCommand` (src/commands/plan.ts:701-706) checks that resume mode is
combined with `mode === "file"` and emits
`--resume-draft cannot be combined with intent text/file`. The message is
misleading: the operator did not pass intent text; they passed a directory.
The same trap exists for `--resume`.

`prepareResume` (src/commands/plan.ts:334) already uses `basename(specPath)`
and `dirname(specPath)`, but it is unreachable when the parser misroutes the
argument first. Even if it were reachable, passing a directory path would
produce wrong `parentDir`/`specDirBasename` values because `dirname("spec/foo/")`
returns `"spec"`, not `"spec/foo"`. The resolution has to happen at the
parser level, where the resume mode is known so we can pick the correct
file (`index.md` vs `intent.md`) inside the directory.

## Scope and decisions

- Fix lives in `src/commands/plan-args.ts` only. No changes to
  `prepareResume` or the runtime checks in `src/commands/plan.ts`. The
  parser already knows `resume` / `resumeDraft`; resolve the directory to a
  file there so the downstream contract (`mode === "file"` with an
  `intentPath`) is unchanged.
- When `--resume` or `--resume-draft` is set and the positional argument is
  an **existing directory**, the parser resolves it to a file inside the
  directory:
  - `--resume` → `<dir>/index.md`
  - `--resume-draft` → `<dir>/intent.md`
- After the directory-to-file rewrite, the parser uses the same
  `isExistingFile` check it already runs. If the rewritten path does not
  exist as a file, the parser returns a structured error that names the
  resolved file rather than the original directory, so the operator can fix
  the spec or the flag:
  - `plan: --resume requires <dir>/index.md but no such file exists`
  - `plan: --resume-draft requires <dir>/intent.md but no such file exists`
- When `--resume` / `--resume-draft` is set and the positional argument is a
  path that exists as **neither a file nor a directory**, the parser
  preserves today's behavior of returning a structured `ok: false` result
  with a clear message rather than silently degrading to inline intent. The
  message must name the resume flag and the resolved path, and must not say
  "intent text" because the operator did not pass intent text:
  - `plan: --resume spec path not found: <resolved-path>`
  - `plan: --resume-draft spec path not found: <resolved-path>`
- When `--resume` / `--resume-draft` is not set, behavior is unchanged. A
  positional argument that is an existing file becomes `mode: "file"`; a
  positional argument that is anything else (directory, missing path,
  inline string) still becomes `mode: "inline"`. The directory-to-file
  rewrite and the "spec path not found" error are gated on the resume
  flags.
- Relative paths continue to resolve against the effective `cwd` (the
  `--cwd` value when supplied, else `processCwd`). Absolute paths are
  honored as-is. Trailing slashes on the directory path are tolerated.
- The downstream `runPlanCommand` resume guard at src/commands/plan.ts:701
  becomes unreachable for the directory-path case but is left in place as
  defense in depth for any future caller that builds a `PlanInvocation`
  with `resume*` set and a non-`file` mode.
- No changes to `--resume` / `--resume-draft` with no positional argument.
  That path is already handled by the existing
  `${resumeFlag} requires a spec path` error in
  `src/commands/plan.ts:697-699`.

## Task Checklist

- [ ] In `parsePlanArgs` (src/commands/plan-args.ts), after the existing
  positional-resolution block, detect the resume / resume-draft case and
  rewrite an existing-directory `candidatePath` to `<dir>/index.md` or
  `<dir>/intent.md` before the `isExistingFile` decision.
- [ ] When the rewritten file does not exist (or when the original
  candidate path exists as neither file nor directory) and a resume flag is
  set, return `ok: false` with a message that names the resume flag and
  the resolved path, never the phrase "intent text".
- [ ] Leave the non-resume code path unchanged: existing files → `file`,
  everything else → `inline`.
- [ ] Add unit tests in `test/plan-command.test.ts` covering directory
  resolution for both flags, the trailing-slash form, the missing-file
  error, the missing-path error, and a regression test asserting that
  passing a directory without a resume flag still falls through to
  `mode: "inline"`.
- [ ] Run `bun run typecheck` and `bun test`.

## Acceptance criteria

- [ ] `parsePlanArgs(["--resume-draft", "<existing-dir>"], cwd)` returns
  `ok: true` with `mode: "file"` and `intentPath` equal to
  `<existing-dir>/intent.md`, provided that file exists.
- [ ] `parsePlanArgs(["--resume", "<existing-dir>"], cwd)` returns
  `ok: true` with `mode: "file"` and `intentPath` equal to
  `<existing-dir>/index.md`, provided that file exists.
- [ ] A trailing slash on the directory argument is tolerated and produces
  the same resolved path as the slash-free form for both flags.
- [ ] When the directory exists but the expected file inside it is missing,
  `parsePlanArgs` returns `ok: false` with `exitCode: 1` and a message that
  contains the resume flag name and the resolved file path (e.g.
  `--resume-draft requires …/intent.md`). The message does not contain the
  substring `intent text`.
- [ ] When the positional argument with `--resume` or `--resume-draft`
  points at a path that exists as neither file nor directory,
  `parsePlanArgs` returns `ok: false` with `exitCode: 1` and a message that
  contains the resume flag name and the resolved path. The message does
  not contain the substring `intent text`.
- [ ] When neither resume flag is set, passing an existing directory as the
  positional argument still produces `mode: "inline"` (existing behavior is
  unchanged).
- [ ] Running `jarvis plan --resume-draft spec/<existing-spec-dir>/` end to
  end no longer emits `--resume-draft cannot be combined with intent text/file`.
  The command proceeds into `prepareResume` exactly as if the operator had
  typed `spec/<existing-spec-dir>/intent.md`.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `docs/plan-mode.md` so the `--resume` and `--resume-draft`
  examples mention that either the spec directory or the explicit file
  path is accepted. Keep at least one example of each form per flag so
  operators can copy whichever matches their muscle memory.
- Update `README.md` `jarvis plan --resume` usage line if it currently
  asserts an `intent.md` / `index.md` path is required; relax it to
  "spec directory or the file inside it". Do not change the no-arg usage
  block.
- No changes to `docs/spec-guidance.md` (spec layout is unchanged).
- No changes to `AGENTS.md` (workflow is unchanged).
