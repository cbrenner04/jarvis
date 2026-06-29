# Lint-clean plan spec markdown before ready

## Problem

Plan draft output (`index.md`, numbered subspecs) can trip `lint:md` during the
post-plan `bun run ready` gate (observed `MD034` on programmatic
`repo: https://github.com/...` injection; model-emitted bare URLs and other
default-rule violations are possible in subspecs). The draft PR stays draft and
the operator hand-fixes markdown.

## Decisions

- Shape harness-owned `repo:` at inject: when the value normalizes to
  `github.com/<owner>/<repo>`, emit portable `owner/repo` slug; otherwise wrap
  `http:`/`https:` values in angle brackets (`repo: <url>`). Rules out leaving
  bare HTTPS in `injectRepoLineIntoIndex` and rules out depending on autofix for
  a deterministic harness line.
- Extend `readRepoPath` to strip one surrounding `<>` pair from the parsed repo
  value so angle-bracket injection stays resolver-safe. Rules out breaking run
  resolution when MD034-safe emit uses brackets.
- Run harness-pinned `markdownlint --fix` over plan spec markdown (`index.md`,
  `NN-*.md` under the active spec dir; exclude `intent.md` and `verdict-*.md`)
  immediately before plan `runReadyAndCommit`, after all draft/review agent
  writes for the invocation. Rules out draft-only repair (review actuator can
  reintroduce violations) and rules out moving or relaxing the ready-tier
  `lint:md` step.
- Reuse the intent emit subprocess contract: pinned
  `node_modules/markdownlint-cli2/markdownlint-cli2.js`, absolute
  `.markdownlint-cli2.jsonc` via `--config`, cwd at harness anchor, ignore
  nonzero exit from residual non-autofixable violations, warn (not fail/silent)
  on spawn failure. Extract shared helper from `v1/src/commands/intent.ts` when
  plan needs the same surface. Rules out `npx` and target-repo config drift via
  `project.root` cwd.
- Do not fail plan on residual post-autofix lint violations; `lint:md` in the
  ready gate remains authoritative. Rules out the reverted intent emit
  residual-failure path.
- Deferred to first consumer: whether `commit: false` external spec trees outside
  harness `lint:md` globs need the same repair — pin when an operator runs lint
  against external storage.

## Task checklist

- Update `injectRepoLineIntoIndex` to emit MD034-safe `repo:` values per
  decisions above; adjust `readRepoPath` for angle-bracket stripping.
- Extract or share the markdownlint autofix helper (from intent emit) and invoke
  it from plan `maybeMarkPlanPrReady` / `runReadyAndCommit` wiring immediately
  before built-in `bun run ready`.
- Add unit tests: inject emits slug for GitHub HTTPS origin; inject wraps
  non-slugifiable `https:` URL in angle brackets; `readRepoPath` resolves
  bracketed values; repair pass cleans seeded violations on fixture spec tree
  (skip-with-signal when binary absent).
- Update `plan-inject-repo-line.test.ts` for slug/bracket `repo:` emit;
  confirm intent emit repair tests stay green after helper extraction.

## Acceptance criteria

- [ ] `injectRepoLineIntoIndex` writes `repo: owner/repo` (no bare URL) when the chosen value is a GitHub URL normalizable to `github.com/owner/repo`.
- [ ] `injectRepoLineIntoIndex` writes `repo: <https://…>` (angle-bracket wrapped, no bare URL) when the chosen value is an `http:`/`https:` URL that does not normalize to a GitHub slug.
- [ ] `readRepoPath` resolves a `repo: <https://github.com/owner/repo>` line to a value `jarvis1 run` can match against registered origins (same loose URL match as an unwrapped HTTPS line).
- [ ] Before plan `runReadyAndCommit`, jarvis runs markdownlint `--fix` on the active spec dir's `index.md` and `NN-*.md` files using the pinned binary and harness `.markdownlint-cli2.jsonc` with cwd anchored to the harness repo.
- [ ] A test seeds a spec tree with a bare `https://` URL in a subspec and/or an injectable `repo:` line, runs the plan repair hook, and asserts `bun run lint:md` exits 0 over that tree afterward; skips with a signal when the markdownlint binary is absent.
- [ ] Residual non-autofixable markdownlint violations after autofix do not fail plan; spawn failure or missing binary warns to stderr and continues.
- [ ] `lint:md` remains a step in the full ready tier in its existing position in `scripts/ready.ts` — not relaxed or reordered.
- [ ] `v1/test/intent-command.sandbox-unrunnable.test.ts` emit-repair cases stay green after any shared-helper extraction.
- [ ] After a successful committed `jarvis1 plan` run whose generated spec lives under a path `lint:md` scans, `bun run lint:md` exits 0 with no operator edits to the generated spec tree. (Manual)

## Documentation updates

- `v1/docs/plan-mode.md`: note plan spec markdown is markdownlint-autofixed (pinned binary, harness config, anchored cwd) immediately before the auto-ready `bun run ready` gate, that programmatic `repo:` injection emits MD034-safe forms, and that residual violations still fail at `lint:md` in ready.
- `v2/docs/v1-behaviors.md`: update plan-mode draft/ready entry — generated `index.md`/subspecs get pre-ready markdownlint autofix; `injectRepoLineIntoIndex` emits slug or angle-bracket `repo:` values; ready-tier `lint:md` unchanged.
