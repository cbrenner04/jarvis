# Pin dependent split prerequisite blocking

## Problem

The plan prerequisite gate is documented and structurally tested, but no command-level regression
proves a later-surface ready-intent blocks while an earlier-surface behavior is absent. The gate or
its prompt can regress while split intents still draft against missing foundations.

## Decisions

- Exercise `planCommand` in git-disabled mode with a prompt-sensitive fake draft agent — rules out a validator-only test or GitHub fixture that cannot pin prompt-to-exit behavior.
- Fixture target omits a named prerequisite marker; the ready-intent prerequisite names that marker — rules out a hand-written blocker with no repo check.
- Fake agent blocks only when the assembled draft prompt includes the prerequisite gate and the marker is absent; otherwise it drafts — rules out a hard-coded blocker that stays green when the gate is removed or inverted.
- Keep production gate code unchanged — rules out a second intent-order or filename gate for behavior already owned by plan prerequisites.
- Extend the intent split contract in `v2/docs/workflow-runner.md` with the downstream plan gate — rules out a second durable workflow contract.

## Prerequisites

- Multi-surface seeds fan out into separate ready-intents that name each touched surface.
- The intent split prompt instructs surface fan-out and cross-surface `## Prerequisites` wiring in dependency order.
- Plan draft prerequisite gate: unconfirmed prerequisite appends `## Blocker` to `intent.md`, writes no spec files, and fails the workflow (`plan.draft.blocker`).

## Task checklist

- Add `v1/test/plan-command.test.ts` regression `dependent split intent blocks while prerequisite behavior is absent`.
- Fixture: registered git-disabled project without the prerequisite marker; ready-intent names that behavior in `## Prerequisites`.
- Fake agent: if prompt carries the prerequisite gate and marker is absent, append `## Blocker` naming the behavior and write no `index.md`/subspecs; else `writeDraftSpec`.
- Assert non-zero exit, blocker names the behavior, no spec tree, ready-intent retained.
- Update `v2/docs/workflow-runner.md` intent split contract: later surfaces encode order as prerequisite behaviors; plan blocks until observable.

## Acceptance criteria

- [ ] `v1/test/plan-command.test.ts` test `dependent split intent blocks while prerequisite behavior is absent` exits non-zero, reports a `## Blocker` naming the missing behavior, and produces no `index.md` or numbered subspec; it fails against the pre-fix harness and fails if the fake agent drafts when the prerequisite gate text is absent from the prompt.
- [ ] Inverting the fake agent's absent-prerequisite gate/pass branch makes `dependent split intent blocks while prerequisite behavior is absent` fail.
- [ ] `v2/docs/workflow-runner.md` states that later surface intents encode order as prerequisite behaviors and `jarvis1 plan` blocks until those behaviors are observable rather than drafting against them.
- [ ] `bun run typecheck` and `bun run test:v1` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — connect dependency-ordered split prerequisites to plan blocking.
- No `v2/docs/v1-behaviors.md` change: runtime behavior is unchanged and its prerequisite-gate entry already records the contract.
