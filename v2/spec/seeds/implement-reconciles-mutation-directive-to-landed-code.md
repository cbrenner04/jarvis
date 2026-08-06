---
name: implement-reconciles-mutation-directive-to-landed-code
---

# A `target_absent` mutation-checkpoint directive hard-blocks instead of reprompting the agent to fix it

The plan authors a mutation-checkpoint `@mutate` directive by **quoting call-site syntax for
not-yet-written code** — e.g. `isDescendantOfBase(worktreeHead, baseRef)`. The implementer writes
the real call with a different signature (extra args, renamed locals, or several call sites), so the
directive's quoted original text is `target_absent` (or would be ambiguous). `spec.criteria-ticked`
then reports `Unparseable mutation checkpoints … target_absent` and settles the run **`blocked` /
`resumable: false`** — even though the production behavior *is* implemented and the pin is one edit
from correct.

This is not the hollow-linking case ([[mutation-checkpoint-criterion-must-name-enclosing-test]],
about the criterion not naming its test); here the criterion selects fine and the directive is in the
pinning file, but its quoted **original source text** does not match the landed call.

## Evidence (all three subspecs of `implement-completion-honesty`, 2026-08-05)

- **00** (run `c45192d7`): `// @mutate cleanup.ts "isDescendantOfBase(worktreeHead, baseRef)"` —
  real call is 4-arg `isDescendantOfBase(worktreeHead, baseRef, projectRoot, runner)`. Blocked.
- **01** (run `f30b3034`): `"shouldFailTerminalCompletionForDirtyWorktree(uncommittedPaths)"` (real:
  `(undefined, uncommitted)`, 3 call sites) and `"hasCompletedSubspec(completionInventory)"` (real:
  `hasCompletedSubspec(inventory)`, 2 call sites → ambiguous). Blocked; code was green (185/185).
- Each cost a hand-fix: retarget the directive to the unique real call site, verify it reddens,
  re-tick. Every subspec blocked on this, never on the actual implementation.

The write agent is told the exact `file:line: target_absent: <directive>` in the contract failure, yet
settles non-resumable instead of fixing the one line it already wrote. Recovery should fold into the
loop, not require an operator.

## Decisions

- When `spec.criteria-ticked` fails **only** because a selected criterion's linked directive is
  `target_absent`/ambiguous (unparseable) — not hollow-no-directive and not a real red suite — the
  write loop reprompts the agent with the named directive + reason for an in-run fix (retarget the
  quoted original to the landed call, keeping it unique and red-on-revert), within the existing
  reprompt budget, rather than settling `blocked` / `resumable: false`. Rules out a hard block on a
  one-line pin-text mismatch the agent can self-heal.
- Plan/authoring guidance: a mutation-checkpoint directive's quoted original should prefer a **unique,
  stable anchor** (a definition line, a unique enclosing statement) over a bare call expression whose
  argument names/arity the implementer may change or which recurs at multiple call sites. Extends
  [[plan-review-must-falsify-guard-premises]].
- Out of scope: changing the `@mutate` format (single-line text replacement) or the strict linker.

## Acceptance criteria

- [ ] A write-loop regression drives a ticked mutation-checkpoint criterion whose pinning-file
      directive is `target_absent` against the landed source, and asserts the loop **reprompts**
      (records the directive + `target_absent` reason and re-enters the agent) instead of settling
      `blocked`/`resumable: false`; a run that exhausts the reprompt budget still blocks. Fails
      against the current hard-block boundary.
- [ ] The reprompt payload names the offending `pinningFile:line`, the raw directive, and the
      `target_absent`/`ambiguous` reason verbatim; a test pins the payload text.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — prefer a unique/stable anchor for
      the directive's quoted original; a bare call expression with implementer-chosen argument names
      or multiple call sites risks `target_absent`/ambiguous.
- [ ] Mutation checkpoint: a `// @mutate` directive inverting the "unparseable-only → reprompt"
      predicate (so it falls through to hard block) turns its pinning test RED; author it single-line
      naming the enclosing test verbatim.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `target_absent`/ambiguous mutation directive now
  reprompts within the run; only budget exhaustion blocks. Remove the operator hand-fix workaround
  once this ships.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — stable-anchor guidance above.

## Prerequisites

- `verifyMutationCheckpoints` / `resolveLinkedDirectives` (`v2/src/execution/mutation-checkpoint-verifier.ts`)
  report `unparseable` with `target_absent`/`ambiguous` reasons and `pinningFile:line` coordinates.
- The write-loop `spec.criteria-ticked` boundary that currently settles `blocked`/`resumable: false`
  on unparseable checkpoints, and its reprompt budget.
