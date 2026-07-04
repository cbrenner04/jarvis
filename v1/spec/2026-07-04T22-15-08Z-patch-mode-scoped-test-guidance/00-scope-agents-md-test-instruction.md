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
- "Touched files" is measured against the branch/merge-base — all files
  changed across the active subspec's work so far, not just the last commit
  or the current working-tree diff — since a subspec can span multiple
  commits touching different surfaces. State this diff base in the rewritten
  `AGENTS.md` sentence itself, not only here.
- `bun run typecheck` stays unscoped — it already type-checks all four
  `tsconfig.json` projects in one invocation.
- No code/tooling change: this is a prompt-guidance edit to `AGENTS.md`. The
  agent determines "touched files" itself (e.g. `git diff <merge-base>...`)
  for the active subspec; no new harness helper is introduced.
- The rewritten sentence keeps the existing "before ticking the acceptance
  criteria they cover" clause, since that phrase is what scopes this
  instruction to patch mode — plan mode never ticks acceptance criteria, so
  losing the clause would make the guidance read as applying to plan mode too.
- Grepped `v1/docs/` and root-level docs for `bun run test` / full-suite
  agent instructions: only `v1/docs/operator-runbook.md` mentions `bun run
  test`, and each mention is either the CI description (accurate,
  non-authoritative) or a human-operator recovery step, not an agent
  instruction — no edit needed there. No other doc in `v1/docs/` or root
  instructs agents to run the full suite.

## Task checklist

- [ ] Replace the `AGENTS.md` line "Run `bun run typecheck` and `bun run test`
      before ticking the acceptance criteria they cover." with guidance that:
      scopes the test script(s) to the active subspec's touched surface(s)
      per the Decisions rule above, states the branch/merge-base diff scope,
      keeps `bun run typecheck` unscoped, keeps the "before ticking the
      acceptance criteria they cover" clause, and leaves the adjacent "Do not
      run `bun run ready`" sentence unchanged.

## Acceptance criteria

- [ ] `AGENTS.md`'s "Working rules for agents" section instructs agents to run
      `bun run typecheck` (unscoped) plus the surface-scoped test script(s)
      matching the active subspec's touched files since the branch/merge-base,
      stating the same v1/v2/shared/root-tooling rule as
      `scripts/ci-test-scope.ts`.
- [ ] The rewritten sentence still ties this instruction to "before ticking
      the acceptance criteria they cover," keeping it legible as patch-mode-only
      guidance.
- [ ] The adjacent "Do not run `bun run ready`" instruction is unchanged.
- [ ] `bun run lint:md` passes on the edited `AGENTS.md`.

## Documentation updates

- Root `AGENTS.md` — the instruction line itself (this subspec's only doc
  change; per the Decisions doc-sweep note, no other `v1/docs/` or root doc
  instructs agents to run the full suite, so none needs editing).
