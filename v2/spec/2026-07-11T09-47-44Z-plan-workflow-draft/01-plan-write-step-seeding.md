# Plan write-step intent seeding and prompt rendering

Wire the `plan` write step's run-time behavior: seed `<spec-dir>/intent.md` from the builder-threaded `intentSeed`, supply the four required `plan.prompt.draft` placeholders, and apply the `spec/<NAME>/` output-path rewrite so the agent drafts into the timestamped spec dir.

## Verified prerequisites

- The `plan` preset builder threads `intentSeed` and the timestamped `NAME` onto one `write` step (subspec 00).
- `plan.prompt.draft` declares `WORKDIR`, `NAME`, `INTENT`, `SPEC_GUIDANCE` as required placeholders. Source: `prompts/plan/draft.md`.
- The write step runs inside a worktree established by `withExternalWorktree`. Source: `v2/src/execution/workflow-runner.ts`, `v2/src/execution/external-worktree.ts`.

## Decisions

- `intent.md` is seeded by the **write step at run time**, not the builder: the step writes `<spec-dir>/intent.md` from `intentSeed` after the worktree exists and before invoking the agent; rule out passing content only through the `INTENT` placeholder — the durable on-disk `intent.md` is the blocker/audit target subspec 02 inspects.
- The step supplies all four required placeholders: `WORKDIR` = worktree root, `NAME` = the timestamped spec-dir basename, `INTENT` = the ready-intent content, `SPEC_GUIDANCE` = the bundled spec-guidance doc content (the same guidance v1 injects, read from the jarvis-bundled doc); rule out relying on the agent to read guidance itself — a missing required placeholder fails the render.
- The step reconciles the prompt's literal `spec/<NAME>/` output path with the timestamped spec dir by porting v1's rewrite: replace `spec/<NAME>/` with `<targetDir>/<NAME>/` and set `NAME` to the timestamped basename, so the agent writes to and the contract inspects the same `<targetDir>/<UTC-timestamp>-<name>/`; rule out leaving the literal `spec/<NAME>/`. Source: `v1/src/modes/plan/draft.ts` `buildDraftPrompt`.
- The interim completion contract stays `index.md`-exists (subspec 02 hardens it); on a passing contract the existing completion publisher commits and opens a draft PR.

## Scope

- Extend the write step so it seeds `<spec-dir>/intent.md` from `intentSeed` inside the worktree before invoking the agent (frontmatter preserved verbatim).
- Supply the `WORKDIR`/`NAME`/`INTENT`/`SPEC_GUIDANCE` placeholders to the `plan.prompt.draft` render with the `spec/<NAME>/`→`<targetDir>/<NAME>/` rewrite applied.
- Leave commit + draft-PR publish to the existing completion path; do not change the draft output contract or blocker gate (subspec 02).

## Acceptance criteria

- [x] A successful run seeds the ready-intent verbatim to `<spec-dir>/intent.md` (frontmatter preserved) inside the worktree before the agent runs, on branch `plan/<name>`, under spec dir `<targetDir>/<UTC-timestamp>-<name>/`.
- [x] The write step renders `plan.prompt.draft` with all four required placeholders (`WORKDIR`, `NAME`, `INTENT`, `SPEC_GUIDANCE`) satisfied.
- [x] The `spec/<NAME>/` output path is rewritten so the agent writes into `<targetDir>/<UTC-timestamp>-<name>/` (agent-written path and inspected path match).
- [x] A passing `index.md`-exists contract commits and opens a draft PR via the existing completion publisher.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` registered-preset list and workflow usage with the `plan` run-time `intent.md` seeding step and the `WORKDIR`/`NAME`/`INTENT`/`SPEC_GUIDANCE` placeholder supply with the `spec/<NAME>/` rewrite.
