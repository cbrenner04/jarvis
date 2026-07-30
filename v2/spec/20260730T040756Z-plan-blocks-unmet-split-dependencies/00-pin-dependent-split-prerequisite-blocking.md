# Pin dependent split prerequisite blocking

## Problem

The plan prerequisite gate is documented and structurally tested, but no command-level regression
proves a later-surface ready-intent blocks while an earlier-surface behavior is absent. The gate or
its prompt can regress while split intents still draft against missing foundations.

## Decisions

- Exercise `planCommand` in git-disabled mode with a prompt-sensitive fake draft agent — rules out a validator-only test or GitHub fixture that cannot pin prompt-to-exit behavior.
- Fixture target uses a dedicated prerequisite-evidence file outside the intent/spec tree; the ready-intent names the behavior evidenced only by that file — rules out text in the intent or staged spec satisfying the check accidentally.
- Fake agent inspects the assembled prompt and fixture filesystem: it blocks without drafting only when the prompt requires repository inspection and prerequisite evaluation, directs an absent behavior to block, and the evidence file is absent; it drafts when the same prompt directs an observable behavior to proceed and the file exists — rules out an always-blocking fake and a hard-coded blocker.
- Treat git-disabled evidence as filesystem observability, not committed-history validation.
- Keep production gate code unchanged — rules out a second intent-order or filename gate for behavior already owned by plan prerequisites.
- Extend the intent split contract in `v2/docs/workflow-runner.md` with the downstream plan gate — rules out a second durable workflow contract.

## Prerequisites

- Multi-surface seeds fan out into separate ready-intents that name each touched surface.
- The intent split prompt instructs surface fan-out and cross-surface `## Prerequisites` wiring in dependency order.
- Plan draft prerequisite policy: an unconfirmed prerequisite appends `## Blocker` to `intent.md`, writes no spec files, and fails `jarvis1 plan` non-zero. Engine-specific signals are documented by their owning engine.

## Task checklist

- Add `v1/test/plan-command.test.ts` command-level regression `dependent split intent blocks while prerequisite behavior is absent`, including its observable-behavior pass path.
- Fixture: registered git-disabled project and ready-intent whose prerequisite names a behavior represented solely by a dedicated repository evidence file, never by intent or spec text.
- Fake agent: require the prompt to tell it to inspect repository files, evaluate the named prerequisite, block without drafting when absent, and proceed when observable; append `## Blocker` naming the behavior and write no `index.md`/subspecs only for the absent-file case, otherwise `writeDraftSpec` for the present-file case.
- Assert absent evidence returns non-zero, retains the ready-intent, names the behavior in `## Blocker`, and produces no spec tree; assert present evidence exits successfully and writes an index and numbered subspec.
- Make the prompt assertion mutation-sensitive: removing or reversing any of the repository-inspection, prerequisite-evaluation, absent-block/no-draft, or observable-proceed instructions makes the regression fail; separately invert the fake absent/present branch to prove the outcome assertions fail.
- Update `v2/docs/workflow-runner.md`: later surfaces encode order as prerequisite behaviors; the shared policy blocks planning until evidence is observable, while v1 and v2 expose their own command/result signals.

## Acceptance criteria

- [ ] `v1/test/plan-command.test.ts` test `dependent split intent blocks while prerequisite behavior is absent` uses a dedicated fixture repository file as the only prerequisite evidence. Without that file, `jarvis1 plan` exits non-zero, appends `## Blocker` naming the missing behavior, retains the ready-intent, and writes neither `index.md` nor a numbered subspec; with that file, it exits successfully and drafts both files.
- [ ] `dependent split intent blocks while prerequisite behavior is absent` fails when the production draft instruction to inspect repository files, evaluate the named prerequisite, block without drafting when absent, or proceed when observable is removed or reversed.
- [ ] Inverting the fake agent's absent-evidence block/present-evidence draft branch makes `dependent split intent blocks while prerequisite behavior is absent` fail.
- [ ] `v2/docs/workflow-runner.md` states that later surface intents encode order as prerequisite behaviors and the shared plan policy blocks until those behaviors are observable rather than drafting against them, without assigning a v2-only signal to `jarvis1 plan`.
- [ ] `bun run typecheck` and `bun run test:v1` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — connect dependency-ordered split prerequisites to plan blocking.
- No `v2/docs/v1-behaviors.md` change: runtime behavior is unchanged and its prerequisite-gate entry already records the contract.
