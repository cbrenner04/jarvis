# Lint-clean plan spec markdown before ready

## Problem

Default `commit: true` plan output (`index.md`, numbered subspecs) can trip `lint:md`
during the post-plan `bun run ready` gate — model-emitted bare URLs and other
default-rule violations in subspecs are the north-star failure mode. The draft PR
stays draft and the operator hand-fixes markdown.

Secondary: `commit: false` harness inject (`injectRepoLineIntoIndex`) can emit bare
`repo: https://…` or `repo: git@github.com:…` (`MD034`). `commit: true` strips
non-contract `index.md` lines (including `repo:`) at draft; inject does not run
there.

## Decisions

- Primary `commit: true` fix: `repairPlanSpecMarkdown` runs harness-pinned
  markdownlint `--fix` on the active spec dir (`index.md`, `intent.md`, `NN-*.md`;
  exclude `verdict-*.md`) immediately before the readiness transition, after all
  draft/review writes. Rules out draft-only repair and rules out moving or relaxing
  ready-tier `lint:md`.
- Include `intent.md` in repair scope. Rules out leaving `intent.md` lint-only
  while `lint:md` globs scan `v1/spec/**/*.md` (ready-intent copy is verbatim).
- `repairPlanSpecMarkdown` runs in the plan worktree from `safeMarkPlanPrReady`
  immediately before `maybeMarkPlanPrReady` (which calls `runReadyAndCommit`), so
  autofix edits land in porcelain before the pre-ready fix commit. Rules out
  invoking repair inside `runReadyAndCommit` after porcelain is classified.
- Successful `commit: true` `--resume` runs the same `repairPlanSpecMarkdown` →
  `safeMarkPlanPrReady` path as a fresh run. Rules out doc claims that resume
  retries ready without wiring repair on the resume exit path.
- After repair, re-run `stripNonContractIndexLines` when `commit: true`. Rules out
  review-reintroduced non-contract `index.md` lines (e.g. `repo:`) surviving
  autofix-only cleanup.
- Apply `keepIssueReferencesOffLineStart` to each repaired file before autofix
  (same guard as intent emit). Rules out MD018 reference→heading corruption on
  line-leading `#NNN` in subspecs.
- Secondary `commit: false` inject: slugifiable GitHub origins (`https://`,
  `git@github.com:`, scp-style) emit `repo: owner/repo`; other `http:`/`https:`
  values wrap in angle brackets (`repo: <url>`). Rules out bare URL/SSH in inject
  and rules out depending on autofix for deterministic harness lines.
- Extend `readRepoPath` to strip one surrounding `<>` pair from parsed `repo:`
  values. Rules out breaking run resolution when MD034-safe emit uses brackets.
- Extract shared markdownlint subprocess surface to `v1/src/markdownlint-repair.ts`;
  `intent.ts` and plan import from there. Rules out `modes/plan/` →
  `commands/intent.ts` back-import.
- Reuse intent emit subprocess contract: pinned
  `node_modules/markdownlint-cli2/markdownlint-cli2.js`, absolute
  `.markdownlint-cli2.jsonc` via `--config`, cwd at harness anchor, ignore nonzero
  exit from residual non-autofixable violations, warn (not fail/silent) on spawn
  failure. Rules out `npx` and target-repo config drift via `project.root` cwd.
- Do not fail plan on residual post-autofix lint violations; `lint:md` in the
  ready gate remains authoritative. Rules out the reverted intent emit
  residual-failure path.
- Deferred to first consumer: whether `commit: false` external spec trees outside
  harness `lint:md` globs need the same repair — pin when an operator runs lint
  against external storage.

## Task checklist

- Add `v1/src/markdownlint-repair.ts` with shared autofix + MD018 guard; refactor
  intent emit to import it.
- Implement `repairPlanSpecMarkdown` (file enumeration, MD018 guard, autofix,
  post-repair `stripNonContractIndexLines` when `commit: true`); call from
  `safeMarkPlanPrReady` before `maybeMarkPlanPrReady` on fresh and resume success
  (`commit: true` only).
- Update `injectRepoLineIntoIndex` for slug/bracket `repo:` emit (HTTPS + SSH);
  extend `readRepoPath` for angle-bracket stripping.
- Add unit tests: inject slug for GitHub HTTPS and SSH origins; inject bracket-wrap
  for non-slugifiable `https:` URL; `readRepoPath` resolves bracketed and slug
  `repo:` lines; `repairPlanSpecMarkdown` cleans seeded violations including
  `intent.md` (skip-with-signal when binary absent); resume success path invokes
  repair before ready.
- Update `plan-inject-repo-line.test.ts`; confirm
  `intent-command.sandbox-unrunnable.test.ts` emit-repair cases stay green.

## Acceptance criteria

- [x] `repairPlanSpecMarkdown` runs markdownlint `--fix` on the active spec dir's
  `index.md`, `intent.md`, and `NN-*.md` (excluding `verdict-*.md`) via the pinned
  binary and harness `.markdownlint-cli2.jsonc` with cwd anchored to the harness
  repo, immediately before `maybeMarkPlanPrReady` enters `runReadyAndCommit`.
- [x] `repairPlanSpecMarkdown` applies `keepIssueReferencesOffLineStart` to each
  target file before autofix.
- [x] After `repairPlanSpecMarkdown`, `stripNonContractIndexLines` runs on
  `index.md` when `commit: true`.
- [x] Successful `commit: true` `jarvis1 plan --resume …` invokes
  `repairPlanSpecMarkdown` then `safeMarkPlanPrReady` (same as fresh-run success).
- [x] `injectRepoLineIntoIndex` writes `repo: owner/repo` (no bare URL) when the
  chosen value is a GitHub HTTPS or SSH/scp-style origin normalizable to
  `github.com/owner/repo`.
- [x] `injectRepoLineIntoIndex` writes `repo: <https://…>` (angle-bracket wrapped,
  no bare URL) when the chosen value is an `http:`/`https:` URL that does not
  normalize to a GitHub slug.
- [x] `readRepoPath` resolves `repo: <https://github.com/owner/repo>` and
  `repo: owner/repo` to values `jarvis1 run` can match against registered origins.
- [x] A test seeds a spec tree with bare `https://` in a subspec and/or injectable
  `repo:` line plus an `intent.md` violation, runs `repairPlanSpecMarkdown`, and
  asserts `bun run lint:md` exits 0 over that tree afterward; skips with a signal
  when the markdownlint binary is absent.
- [x] Residual non-autofixable markdownlint violations after autofix do not fail
  plan; spawn failure or missing binary warns to stderr and continues.
- [x] `lint:md` remains a step in the full ready tier in its existing position in
  `scripts/ready.ts` — not relaxed or reordered.
- [x] `v1/test/intent-command.sandbox-unrunnable.test.ts` emit-repair cases stay
  green after shared-helper extraction.
- [x] After a successful `commit: true` `jarvis1 plan` run whose spec lives under
  `lint:md` globs and auto-ready transition succeeds, `bun run lint:md` exits 0
  with no operator edits to the generated spec tree. (Manual)

## Documentation updates

- `v1/docs/plan-mode.md`: repair scope (`index.md`, `intent.md`, numbered
  subspecs; exclude `verdict-*.md`); `repairPlanSpecMarkdown` before
  `runReadyAndCommit`; resume runs same repair-then-ready path; programmatic
  `repo:` inject emits MD034-safe forms (`commit: false` only); residual
  violations still fail at `lint:md` in ready.
- `v1/docs/spec-guidance.md`: index example and accepted `repo:` shapes use slug
  or angle-bracket canonical forms (no bare `https://` in examples).
- `v2/docs/v1-behaviors.md`: plan-mode draft/ready entry — pre-ready
  `repairPlanSpecMarkdown` on generated spec markdown; `injectRepoLineIntoIndex`
  slug/bracket emit; resume repair-then-ready; ready-tier `lint:md` unchanged.
