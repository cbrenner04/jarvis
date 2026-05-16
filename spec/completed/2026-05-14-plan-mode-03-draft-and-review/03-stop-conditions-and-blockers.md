# 03 — Stop conditions and blocker handling

## Problem

The draft and review phases need explicit stop conditions: clean
completion, Ctrl-C, agent quota exhaustion, and agent-declared
blockers. The first three reuse `jarvis run`'s existing exit codes and
behavior; the blocker case is plan-mode-specific because plan mode is
the only command that produces an `intent.md` for the agent to
annotate.

## Decisions

- **Clean completion.** Draft + all review passes succeed → continue
  to PR-open (which already exists from the previous spec) → exit
  `0`. Already covered by subspecs 01 and 02; this subspec just
  asserts the path end-to-end and adds a stderr "plan: complete" line
  before exit so logs make the boundary obvious.
- **Ctrl-C.** Standard SIGINT handling: propagate to the agent
  process, do not commit any in-progress changes, exit `130`. Same
  behavior as `jarvis run`. If the user interrupts between phases
  (e.g. after the draft commit but before the first review pass), the
  worktree, branch, and PR are left as-is — exactly the state at the
  last completed push.
- **Agent quota exhaustion.** Subspecs 01 and 02 already wire in
  per-phase quota fallback. This subspec asserts that when **all**
  agents are exhausted on a phase, plan mode exits with the same
  quota-exhausted code (`2`) and message text used by `jarvis run`
  (see `docs/run-loop.md` exit-code table). Prior pushed commits
  remain on the branch and the draft PR remains open.
- **Blocker (new behavior).** During any draft or review pass, if the
  agent appends a `## Blocker` section to `spec/<name>/intent.md`,
  plan mode treats this as a structured stop:
  1. Detect by reading `intent.md` after the agent exits and
     searching for an exact `## Blocker` heading (case-sensitive,
     line-anchored, per `docs/spec-guidance.md`'s subspec heading
     contract).
  2. Validation that normally rejects modified `intent.md` is relaxed
     **only** when the modification is the addition of a `## Blocker`
     section. Any other change to `intent.md` still fails validation.
  3. Stage and commit `intent.md` plus any spec changes the agent
     also made in the same pass, with subject `plan: blocker` and
     body:

     ```text
     Blocker raised by <agent-attribution>.
     ```
  4. Push the commit.
  5. Print the `## Blocker` section's body to stderr verbatim so the
     user sees it without opening the worktree.
  6. Exit `1`. Plan mode reuses exit `1` for blockers (rather than
     patch mode's exit `7`) because plan mode is structurally
     different — it has no per-iteration loop and no notion of
     "active subspec"; the harness simply stops after pushing the
     `plan: blocker` commit. The PR stays draft and now contains the
     blocker commit, surfacing the issue to any reviewer.
- **Blocker only valid on `intent.md`.** A `## Blocker` section in any
  *spec* file (not `intent.md`) is treated as content, not a control
  signal. We do not introduce a second blocker convention here.
- **Blocker prompt awareness.** The draft and review prompts (subspecs
  01 and 02) must be updated in this subspec to mention the blocker
  convention: "If you cannot proceed without human input, append a
  `## Blocker` section to `intent.md` describing what you need; do
  not invent answers."
- **No retry after blocker.** Plan mode does not attempt another
  agent after a blocker. The user is expected to read the blocker,
  edit `intent.md` accordingly, and re-run plan mode (resume support
  comes in `spec/2026-05-14-plan-mode-resume-and-handoff/`).
- **Logging.** Each stop reason prints one stderr line before exit:
  `plan: complete`, `plan: interrupted`, `plan: quota exhausted`,
  `plan: blocked`. These help post-hoc log review and let the
  log-server consumers tag sessions consistently.

## Implementation hints

- Add a small `detectBlocker(intentText): { hasBlocker: boolean;
  body?: string }` helper. Use the same heading-matching approach as
  patch mode's `hasBlocker`/`extractBlockerBody` in
  `src/modes/patch/blocker.ts` (line-anchored, case-sensitive
  `## Blocker`); consider lifting the shared parser to
  `src/modes/plan/blocker.ts` rather than re-importing from patch
  mode, to keep the modes independent.
- The relaxed `intent.md` validation should compute "did anything
  other than appending a `## Blocker` section change?" by comparing
  the file before and after agent execution.
- Patch mode already handles SIGINT in `src/modes/patch/run.ts` via
  `handleSignals`; mirror that wiring rather than re-implementing it.

## Tasks

- [ ] Update draft and review prompts to mention the blocker
  convention.
- [ ] Implement `detectBlocker`.
- [ ] Implement the relaxed `intent.md` validation for the blocker
  case (and only that case).
- [ ] Implement the `plan: blocker` commit + push + stderr print.
- [ ] Add `plan: complete | interrupted | quota exhausted | blocked`
  stderr lines at the corresponding exits.
- [ ] Tests:
  - Stub agent appends `## Blocker` to `intent.md` during draft →
    `plan: blocker` commit lands and is pushed; exit `1`; blocker
    body printed to stderr; PR stays draft.
  - Same scenario during review → same behavior; any prior `plan:
    review N` commits are unaffected.
  - Stub agent modifies `intent.md` in a non-blocker way → existing
    exit `1` validation behavior, no `plan: blocker` commit.
  - Ctrl-C between phases → exit `130`, no extra commits, branch/PR
    untouched.
  - All agents quota-exhausted on a pass → existing exit code,
    `plan: quota exhausted` stderr line, no extra commits.
  - Clean run → `plan: complete` printed before exit `0`.

## Acceptance criteria

- [x] Plan mode handles all four stop conditions (complete, Ctrl-C,
  quota, blocker) with the documented exit codes and stderr lines.
- [x] Blocker detection only triggers on `## Blocker` in `intent.md`.
- [x] Non-blocker `intent.md` modifications still fail validation.
- [x] PR remains draft in every stop condition.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 04 covers docs.
