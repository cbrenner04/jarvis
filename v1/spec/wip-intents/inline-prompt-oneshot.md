---
name: inline-prompt-oneshot
---

# Intent: specless prompt command

Add a top-level `jarvis1 --prompt "<text>"` invocation that runs one agent pass
against inline prompt text — no spec, no loop — lets it do the work in a
worktree, then commits, pushes, and opens a PR. A single agent pass with the
full work side effects.

## Why

- Every existing entrypoint (patch, plan, review) requires authoring a spec
  first. There's no way to hand the agent a one-off task and let it run.
- This is very likely going to be used for **real work**, not just questions —
  so it follows the normal work lifecycle (worktree → changes → commit → push →
  PR), just without a spec or loop driving it.
- It should reuse the existing agent fallback, quota handling, and logging
  rather than inventing a parallel path.

## Rough shape

- Flag form: `jarvis1 --prompt "prompt text"`. A bare `jarvis1 "text"` would be
  nicer but collides with subcommand parsing and isn't worth the trouble;
  `--prompt` is good enough.
- Runs in a worktree like the other work modes.
- One agent pass — no loop. Agent selection and fallback reuse the existing
  quota-fallback-error workflow (no new error paths).
- Invocations are logged like any other run (telemetry/invocation rows as
  normal).
- On completion the agent's final action is to **commit, push, and open a PR**
  for whatever it changed, with the standard `Jarvis-Agent:` attribution.
- Uses its **own dedicated config set** for agent/model order — separate from
  `modes.patch` / `modes.plan`, not reused from them.

## Open questions to resolve while drafting

- Exact dedicated config shape/key for this command's agent order + model
  (its own set, e.g. a top-level `prompt` config block).
- Behavior when the pass produces **no diff** (the prompt was a question, not
  work): print the response and skip the PR, or always open one. Default: no
  changes → no PR, just emit the response.
- Worktree and branch naming for a specless run (no spec name to derive from).
- PR body content when there's no spec to summarize — likely the prompt text
  plus the standard attribution footer.

## Acceptance criteria (rough)

- `jarvis1 --prompt "<text>"` runs one agent pass against the text in a
  worktree, with no spec and no loop.
- Agent/model selection uses this command's own dedicated config set, distinct
  from patch/plan.
- Quota, fallback, and errors go through the existing quota-fallback-error
  workflow.
- The invocation is logged like any other run.
- When the pass produces changes, the run commits, pushes, and opens a PR with
  standard attribution; when it produces none, it emits the response and opens
  no PR.
- Docs updated:
  - `v1/docs/` — short reference for the command, its dedicated config, and
    exit codes.
  - `README.md` — one-line mention in the command overview.

## Out of scope

- Multi-turn / conversational sessions.
- The spec and loop lifecycle — this stays a single specless pass.
- Auto-merging the PR. Humans still merge. (PR volume is a known, deferred
  problem.)
- Streaming output if it complicates the single-pass contract.
