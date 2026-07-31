# Terminal publication drops invert-for-test hooks

`terminal-publication.ts` exports three `setInvert*ForTest` setters and module-level
`invert*ForTest` variables so guard-inversion tests pass without mutating real guards.

## Decisions

- Strip all four forbidden hook shapes from `terminal-publication.ts` — inline real guards at call
  sites.
- Delete dedicated invert `describe` block; add `Mutation checkpoint:` comments on positive pinning
  tests.

## Tasks

- **terminal-publication.ts:** remove three `invert*ForTest` module variables and `setInvert*ForTest`
  exports; inline real guards.
- **terminal-publication.test.ts:** delete `describe("terminal publication guard inversion")` and
  setter imports/resets; add `Mutation checkpoint:` comments on `does not ready-flip or merge after a
  red ready gate`, `executes each terminal action type once against fake publication` (leave-draft
  path), and `retains PR evidence on ready gate failure` naming mutations on the red-gate,
  leave-draft no-mutation, and failure-preservation guards.
- Run `bun run typecheck` and `bun test v2/src/execution/terminal-publication.test.ts`.

## Acceptance criteria

- [ ] `terminal-publication.ts` carries no `setInvert*ForTest` export, `invert*ForTest` module
  variable, `invert*` function parameter, or `invert*ForTest` type member.
- [ ] In `terminal-publication.test.ts`, the documented red-ready-gate mutation turns `does not
  ready-flip or merge after a red ready gate` RED. (Manual)
- [ ] `terminal-publication.test.ts` — `does not ready-flip or merge after a red ready gate` stays
  green.
- [ ] `terminal-publication.test.ts` — `executes each terminal action type once against fake
  publication` stays green.
- [ ] `terminal-publication.test.ts` — `retains PR evidence on ready gate failure` stays green.

## Documentation updates

- None — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.
