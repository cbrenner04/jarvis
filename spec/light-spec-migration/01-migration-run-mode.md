# 01 — Migration run mode

## Problem

When the user picks `m` at the non-index prompt (subspec 00), jarvis must
mechanically reshape the supplied spec into the index-routed form documented
in [docs/spec-guidance.md](../../docs/spec-guidance.md) and stop. This is a
one-shot, in-place transformation — not feature work, not a normal loop run.

## Decisions

- Migration runs through the regular agent workflow (same agent fallback
  order, same logging, same worktree handling) but with a distinct, ephemeral
  prompt instead of `buildPrompt(specPath)`.
- Exactly one successful agent iteration. After the agent returns `kind:
  "ok"`, jarvis stops regardless of the spec's checked/unchecked state.
- No migration spec file is written to the target repo. The migration prompt
  is constructed in memory from the supplied spec path and the rules in
  `docs/spec-guidance.md`.
- The migration is in-place. The agent is instructed to:
  - create `spec/<feature>/index.md` and numbered subspecs at the same path
    as the supplied flat spec (replacing the flat file or co-locating per the
    guidance), and
  - preserve the original spec's intent — no rewording of decisions or
    acceptance criteria, no scope changes.
- Quota and `model_config` failures use the existing fallback/abort behavior.
  A non-quota error from the only remaining agent exits non-zero, same as the
  normal loop.
- The migration run does not invoke `assertGhReady` differently from a normal
  run; reuse the existing `skipGhCheck` behavior so tests can opt out.

## Behavior

Entry point shape (suggested):

```ts
async function runMigration(opts: {
  specPath: string;
  project: ProjectMatch;
  cfg: Config;
  agentWorkingDir: string;
  activeAgents: Agent[];
  fanout: Fanout;
  // ...whatever else the existing run loop already constructed
}): Promise<number>
```

The simplest implementation lives inside `src/commands/run.ts` and reuses the
already-constructed log fanout, session log, and agents from `runCommand`.
Factor only what is necessary; do not pre-emptively split files.

Suggested prompt body (kept short, mirrors `buildPrompt` style; final wording
is the implementer's call):

```text
You are migrating a non-compliant Jarvis spec to the index-routed shape.

Read the target repo's spec guidance at docs/spec-guidance.md (or the
equivalent in this repo's AGENTS.md) and follow the "Migrating Flat Specs"
procedure exactly.

Spec to migrate: <SPEC_PATH>

Constraints:
- Preserve the original spec's intent. Do not reword decisions, acceptance
  criteria, or task semantics.
- Split the existing checklist into atomic, independently testable subspecs.
- Create <dir>/index.md with a checklist linking to numbered subspec files.
- Make the migration in place; do not leave the old flat spec behind unless
  the guidance says to.
- Do not implement any of the subspecs. Only reshape the file(s).
```

Banner output should make the mode obvious:

```text
project: <key> | spec: <basename> | mode: migrate | agent: <agent>
```

After the agent's first successful iteration, fanout `migration finished\n`
to stdout/harness and return 0. No completion check, no second iteration.

## Tasks

- [ ] Add a `runMigration` path inside `src/commands/run.ts` invoked from the
  `m` branch added in subspec 00.
- [ ] Build the ephemeral migration prompt described above (extract a
  `buildMigrationPrompt(specPath)` helper if it keeps `run.ts` readable;
  otherwise inline).
- [ ] Reuse the existing fanout, session log, worktree, and agent fallback
  scaffolding. Do not duplicate setup.
- [ ] Stop after one successful iteration. Do not call `countUnchecked`
  before/after; this is not a checklist-driven loop.
- [ ] Treat `quota` results with the existing fallback; treat `model_config`
  and other non-ok results the same as in the normal loop.

## Acceptance criteria

- `jarvis run <flat-spec.md>` followed by `m` runs exactly one agent
  iteration with the migration prompt, then exits 0.
- The migration prompt references `docs/spec-guidance.md` and the supplied
  spec path.
- Banner clearly identifies mode `migrate`.
- No migration spec file is created in the target repo by jarvis itself.
- Quota fallback works: if the first agent is quota-exhausted, jarvis falls
  back and the next agent runs the same migration prompt once.
- `bun run typecheck` and `bun test` pass. New unit test covers the
  one-iteration-then-stop behavior with a stub agent.

## Documentation updates

- None in this subspec; doc changes land in subspec 02.
