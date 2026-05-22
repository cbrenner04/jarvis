# 00 — Document workflow B

## Problem

The recommended jarvis workflow is:

1. Author a spec under `spec/<feature>/` in the target repo's main checkout.
2. Commit and push the spec to the base branch (`main`) so it exists as a
   reviewable artifact independent of any implementation.
3. *Then* run `jarvis run spec/<feature>/index.md`, which creates a worktree
   off the now-up-to-date base. The agent only commits implementation
   changes (and index checkbox flips) into the PR.

This is not currently documented. As a result, users (and the agents in
this repo) sometimes invoke `jarvis run` against an untracked or
uncommitted spec, which causes the spec contents to be swept into the
implementation commit via `git add -A`. The implementation PR then mixes
"the plan" and "the work that fulfills it" in a single diff.

This subspec captures the recommended workflow in docs. The actual
run-start enforcement (a soft prompt) is in subspec 01.

## Decisions

- Refer to this flow as "commit-spec-first" in docs. Do not invent a new
  capitalized label like "Workflow B"; it is the recommended flow, not one
  option among many.
- The docs change the recommendation but do not forbid running against an
  untracked spec. Subspec 01 covers the runtime prompt; this subspec only
  describes the convention.
- The home for the recommendation is `docs/spec-guidance.md`, with a
  shorter pointer from `docs/run-loop.md` (which already documents what
  `jarvis run` does step by step).

## Behavior

After this subspec:

- `docs/spec-guidance.md` has a new top-level section, **"Commit specs
  before running jarvis"**, near the top of the file (after the
  index-routed layout block and before "Subspecs"). It explains:
  - Author the spec on the base branch in the main checkout.
  - Commit and push the spec before invoking `jarvis run`.
  - Why: prevents the spec from being swept into the implementation commit
    via `git add -A`, keeps implementation PRs focused on code, and gives
    the spec a moment of review before the agent loop starts.
  - Notes that `jarvis run` will warn (per subspec 01) when the supplied
    spec path is untracked or has uncommitted modifications on the base
    branch.
- `docs/run-loop.md` gains a short paragraph (or callout) in its
  "Preconditions" / opening section that points to the new spec-guidance
  section. The run-loop doc should not duplicate the reasoning — just point
  to spec-guidance.
- No code changes in this subspec.

## Tasks

- [ ] Add the **"Commit specs before running jarvis"** section to
  `docs/spec-guidance.md` in the location described above.
- [ ] Add the pointer paragraph to `docs/run-loop.md`.
- [ ] Cross-link the two sections (spec-guidance → run-loop and back) using
  markdown anchors.
- [ ] Confirm `bun run check` passes (Biome includes Markdown formatting in
  this repo's check; do not introduce trailing whitespace or inconsistent
  line wrapping).

## Acceptance criteria

- `docs/spec-guidance.md` contains a clearly titled section recommending
  the commit-spec-first flow with the reasoning above.
- `docs/run-loop.md` links to it.
- `bun run check` passes.
- No code or test changes land in this subspec.

## Documentation updates

This subspec **is** the documentation update for the workflow side of this
spec. Subspec 02 handles user-visible behavior docs once the runtime prompt
in subspec 01 exists.
