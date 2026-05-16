# 06 — Unified spec parser

## Problem

The spec grammar is implicit and re-derived in many places via independent
regexes:

- `src/modes/patch/completion.ts`: `taskPattern`, `uncheckedTaskPattern`,
  `uncheckedTaskCapturePattern`, `uncheckedLinkPattern`.
- `src/modes/patch/subspec.ts`: `acceptanceSectionPattern`,
  `criterionLinePattern`, `updateIndexCheckbox` regexes.
- `src/pr.ts`: `extractSpecNames`, `linkedSubspecsAreComplete`, heading
  extraction.
- `src/modes/patch/run.ts`: spec-link regex inside `getLinkedSubspecHeadings`.

Six consumers, each with its own variant. Subspec 04 (blocker detection)
becomes consumer seven. Subspec 09 (telemetry) will reference parts of it.
General mode (future) will be eight. Spec grammar changes today require
hunting down every regex.

A second concrete defect: `extractAcceptanceCriteria` matches
`## Acceptance criteria` exactly, case-insensitive. A subspec that
accidentally uses `### Acceptance criteria` silently has zero criteria and
the run aborts with the "no checkboxes" error. The contract is not
documented at the rule level.

## Behavior

Introduce `src/modes/patch/spec.ts` exporting one function:

```ts
export function parsePatchSpec(content: string): ParsedSpec
```

returning a typed model:

```ts
type ParsedSpec = {
  h1: string | undefined;
  tasks: TaskItem[];                       // every "- [ ]" / "- [x]" line
  linkedSubspecs: LinkedSubspec[];         // tasks whose body is a [text](path) link
  acceptanceCriteria: AcceptanceCriterion[]; // from the "## Acceptance criteria" section only
  blocker: string | undefined;             // body text under "## Blocker", or undefined
}
```

Each consumer migrates to `parsePatchSpec`. The regexes used by consumers
are deleted.

**Contract tightening.**

- The acceptance criteria section header MUST be exactly `## Acceptance
  criteria` (case-sensitive, level-2 heading). Variants (`### `, `## Acceptance
  Criteria`, `## acceptance criteria`) cause the parser to emit
  `acceptanceCriteria: []` AND set a `warnings: string[]` field naming
  what was rejected and why.
- `runCommand` upgrades the existing "no checkboxes" error to surface
  parser warnings verbatim, so the operator learns the exact reason.
- The blocker section header MUST be exactly `## Blocker`.
- These rules are documented in `src/modes/patch/rules.md` and
  `docs/spec-guidance.md`.

Location: mode-local for now. If general mode reuses it, lift to
`src/spec/` then.

## Tasks

- [ ] Implement `src/modes/patch/spec.ts` with `parsePatchSpec` and types.
- [ ] Migrate `completion.ts` consumers.
- [ ] Migrate `subspec.ts` consumers (acceptance criteria snapshot,
      diff key, commit message body).
- [ ] Migrate `pr.ts` consumers.
- [ ] Migrate `run.ts` consumers (link regex inside subspec-headings).
- [ ] Implement parser warnings and surface them in `runCommand`'s
      "no acceptance criteria" error path.
- [ ] Tests: golden parses for representative specs; parser warns on
      malformed headings; existing consumer-level tests pass unchanged.

## Acceptance criteria

- [x] No consumer in `src/modes/patch/` defines its own task / criterion /
      acceptance-section regex; all read from `parsePatchSpec`.
- [x] A subspec using `### Acceptance criteria` produces a parser warning
      that names the rejected heading; `jarvis run` prints that warning in
      the error message.
- [x] All existing tests pass after migration.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.

## Documentation updates

- `src/modes/patch/rules.md`: codify the heading contract (`## Acceptance
  criteria` exactly, `## Blocker` exactly).
- `docs/spec-guidance.md`: same.
