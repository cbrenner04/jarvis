# 00 — Verify aider CLI flags

## Problem

Subspecs 01–03 assume specific aider CLI flags for non-interactive runs,
model selection, auto-commit suppression, and "don't ask for confirmation"
behavior. Before that code lands, the actual flag surface must be confirmed
against a real `aider --help` so the agent module is not built on guesses
that drift from upstream.

## Decisions

- The canonical reference is the installed `aider` CLI on the author's
  workstation plus the published docs at `https://aider.chat/docs/`.
- This subspec produces **no code changes**. Its output is a verified flag
  table recorded in this file under `## Verified flags` for subsequent
  subspecs to copy.
- If verification shows the inferred draft below is wrong, update the draft
  and call out the differences before continuing.

## Inferred draft (to verify, not to ship)

Expected invocation shape:

```sh
aider \
  --message "<prompt>" \
  --model <provider/model> \
  --yes-always \
  --no-auto-commits \
  --no-git \
  --no-stream
```

Open questions to answer during verification:

1. Is `--message` the correct flag for non-interactive single-prompt runs,
   and does it cause aider to exit after producing the response (no REPL)?
2. What is the exact flag for "do not prompt for confirmation"? Candidates:
   `--yes-always`, `--yes`, `--no-confirm`.
3. What is the exact flag for "do not auto-commit edits"? Jarvis manages
   commits itself, so aider's auto-commit must be off.
4. Should jarvis pass `--no-git` (aider runs without git integration) or
   leave git enabled and rely on `--no-auto-commits`? The harness already
   runs inside a worktree, so aider's own git operations should not fight
   with jarvis.
5. How is model selection passed for local LLMs? For Ollama the documented
   form is `--model ollama/<name>` with `OLLAMA_API_BASE` in the
   environment; confirm whether this round-trips through `aider --message`
   the same way.
6. Does aider write any state files (`.aider*`) into the working directory?
   The repo already has `.aider` in `.gitignore` (commit `80b7836`), so
   confirm whether more entries are needed.
7. What exit codes does aider produce for: success, model/auth failure,
   rate-limit / provider error, and unrecoverable internal error? These
   feed the quota/model-config signal detection in subspec 03.

## Tasks

- [ ] Install or locate a working `aider` binary and capture `aider --help`
      in full.
- [ ] Resolve every open question above against the help output and the
      official docs.
- [ ] Record findings under a new `## Verified flags` section in this file,
      including:
      - The exact non-interactive invocation jarvis will use.
      - The model-selection convention for at least one local-LLM backend
        (Ollama is the reference case).
      - Exit-code semantics for success vs. provider error vs. internal
        error.
      - Any extra `.gitignore` entries aider creates that are not already
        ignored.
- [ ] Flag any inferred-draft items that proved wrong so subsequent
      subspecs do not copy stale assumptions.

## Acceptance criteria

- [ ] This file has a `## Verified flags` section containing the finalized
      argv jarvis will spawn, with each flag annotated by the
      `aider --help` line (or docs URL) it was sourced from.
- [ ] Every "Open question" above has an explicit answer recorded in
      `## Verified flags`.
- [ ] Any deviation from the inferred draft is called out explicitly so
      reviewers see what changed.
- [ ] If a local LLM (Ollama or equivalent) is available on the
      implementer's machine, a smoke-run transcript snippet is captured
      in the section. If not, the absence is noted explicitly and the
      smoke run is deferred to subspec 01's test step rather than
      blocking this subspec.

## Documentation updates

- None. Subspec 04 handles README/docs updates after the implementation
  subspecs land.
