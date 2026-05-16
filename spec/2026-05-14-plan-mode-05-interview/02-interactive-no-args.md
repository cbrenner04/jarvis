# 02 — Interactive mode (`jarvis plan` with no args)

## Problem

`jarvis plan` with no positional arguments has been hitting the
skeleton stub exit since `spec/2026-05-14-plan-mode-skeleton/`. Now that the
interview phase exists (subspec 01), interactive mode can drop the
user straight into the interview without requiring intent text up
front.

## Decisions

- **Replace the stub.** When the parser classifies the invocation as
  interactive mode (no positional args), plan mode now:
  1. Resolves the target repo (already done by skeleton subspec 03).
  2. Runs the log-server preflight (already done by skeleton subspec
     05).
  3. Creates the temporary worktree (using subspec 03 of this spec —
     order note below).
  4. Writes a minimal seed `intent.md` containing only:

     ```md
     # Intent

     (Interactive session — no seed text. The interview will gather
     the intent.)
     ```

  5. Runs the interview phase from subspec 01 with the configured
     budget.
  6. Continues into draft + self-review phases as normal.
- **Order with subspec 03.** Subspecs 02 and 03 of this spec interact:
  agent-proposed naming requires the temporary-worktree mechanism
  introduced in subspec 03. To keep this subspec implementable on its
  own, **interactive mode in this subspec uses the deterministic
  fallback name**: literally `interactive-<short-timestamp>`
  (e.g. `interactive-2026-05-13-1430`), still flowing through the
  uniqueness suffix loop. Subspec 03 then replaces this with the
  agent-proposed name end-to-end across all modes.
- **`--interview-turns 0` rejection.** Interactive mode without an
  interview is degenerate. Reject with exit `1` and the message:

  ```text
  plan: --interview-turns 0 is incompatible with interactive mode
  (no intent text was provided)
  ```

  This check happens in the parser dispatcher after classification,
  before any worktree is created.
- **Commit-body label.** The interview-commit body's `Seeded from
  <...>` line uses `interactive` for this mode (per the updated
  shape from subspec 01).
- **No new flags.** The user opts into interactive mode by passing no
  positional argument; no `--interactive` flag is needed (per the
  decisions captured during spec design).
- **Logging.** Print one stderr line at entry: `plan mode:
  interactive session started` so the log-server transcript marks the
  boundary clearly.

## Implementation hints

- Most of the work is dispatch-side: route the interactive branch
  through the same `planCommand` core after writing the minimal seed.
- The "minimal seed" is just a 2–3-line file; a string constant is
  fine.

## Tasks

- [ ] Replace the interactive-mode stub in the dispatcher with the
  full path described above.
- [ ] Add the `--interview-turns 0` + interactive-mode rejection
  before worktree creation.
- [ ] Use `interactive-<short-timestamp>` as the deterministic name
  for interactive mode (subspec 03 will replace this).
- [ ] Tests:
  - `jarvis plan` (no args) with interview budget 3 → minimal seed
    written; interview loop runs (with stub agent); subsequent
    phases run normally; commit body says `Seeded from interactive`.
  - `jarvis plan --interview-turns 0` (no args) → exit `1` with the
    documented message; no worktree created.
  - Interactive mode + log-server down → exit `1` (preflight runs
    first).
  - Interactive mode + bad `--repo` → exit `1` (resolution runs
    first).

## Acceptance criteria

- [ ] `jarvis plan` (no args) runs the full plan-mode flow starting
  from an empty interview.
- [x] `--interview-turns 0` is rejected for interactive mode.
- [x] Interactive sessions produce a `plan: interview` commit with
  body `Seeded from interactive`.
- [x] Preflights still run in the documented order before any
  worktree is touched.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 04 covers docs.
