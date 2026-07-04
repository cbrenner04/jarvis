# Scope the AGENTS.md test instruction to touched surfaces

## Problem

Root `AGENTS.md` tells every patch-mode agent to run the full `bun run test`
before ticking acceptance criteria, even when the active subspec only touches
one surface. CI already scopes its own test step by changed path
(`scripts/ci-test-scope.ts`); agent guidance should follow the same rule.

## Decisions

- Reuse CI's exact classification (`scripts/ci-test-scope.ts`), not a new or
  looser rule: `v1/**` → `test:v1`; `v2/**` → `test:v2` + `test:integration:v2`;
  `shared/**` → all three (`test:v1`, `test:v2`, `test:integration:v2`); root
  tooling touched, or the surface can't be determined → full `bun run test`.
- `bun run typecheck` stays unscoped — it already type-checks all four
  `tsconfig.json` projects in one invocation.
- No code/tooling change: this is a prompt-guidance edit to `AGENTS.md`. The
  agent determines "touched files" itself (e.g. `git diff`) for the active
  subspec; no new harness helper is introduced.
- Checked `v1/docs/operator-runbook.md` for agent-facing full-suite
  instructions: none found — its `bun run test` mentions are either the CI
  description (already accurate, non-authoritative source) or a human
  operator recovery step, not an agent instruction. No edit needed there.

## Task checklist

- [ ] Replace the `AGENTS.md` line "Run `bun run typecheck` and `bun run test`
      before ticking the acceptance criteria they cover." with guidance that
      scopes the test script(s) to the active subspec's touched surface(s)
      per the Decisions rule above, keeping `bun run typecheck` unscoped.

## Acceptance criteria

- [ ] `AGENTS.md`'s "Working rules for agents" section instructs agents to run
      `bun run typecheck` (unscoped) plus the surface-scoped test script(s)
      matching the active subspec's touched files, stating the same
      v1/v2/shared/root-tooling rule as `scripts/ci-test-scope.ts`.
- [ ] `bun run lint:md` passes on the edited `AGENTS.md`.

## Documentation updates

- Root `AGENTS.md` — the instruction line itself (this subspec's only doc
  change; `operator-runbook.md` needs no edit per the Decisions note above).
