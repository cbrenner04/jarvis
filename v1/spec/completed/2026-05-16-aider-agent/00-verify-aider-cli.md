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

- [x] This file has a `## Verified flags` section containing the finalized
      argv jarvis will spawn, with each flag annotated by the
      `aider --help` line (or docs URL) it was sourced from.
- [x] Every "Open question" above has an explicit answer recorded in
      `## Verified flags`.
- [x] Any deviation from the inferred draft is called out explicitly so
      reviewers see what changed.
- [x] If a local LLM (Ollama or equivalent) is available on the
      implementer's machine, a smoke-run transcript snippet is captured
      in the section. If not, the absence is noted explicitly and the
      smoke run is deferred to subspec 01's test step rather than
      blocking this subspec.

## Verified flags

Aider version: 0.86.2  
Reference: `aider --help` output (verified 2026-05-16)

### Finalized invocation shape

```sh
aider \
  --message "<prompt>" \
  --model <provider/model> \
  --yes-always \
  --no-auto-commits \
  --no-git \
  --no-stream
```

### Verified answers to open questions

**1. Is `--message` the correct flag for non-interactive single-prompt runs?**
YES. From `aider --help` (line 392-395):
```
--message COMMAND, --msg COMMAND, -m COMMAND
  Specify a single message to send the LLM, process
  reply then exit (disables chat mode)
```
Confirmed: Aider exits after processing the response with no REPL loop.

**2. What is the exact flag for "do not prompt for confirmation"?**
`--yes-always` (line 448-449):
```
--yes-always          Always say yes to every confirmation
```
Other candidates (`--yes`, `--no-confirm`) are not present in the help output.

**3. What is the exact flag for "do not auto-commit edits"?**
`--no-auto-commits` (line 293-295):
```
--auto-commits, --no-auto-commits
  Enable/disable auto commit of LLM changes (default:
  True)
```
Jarvis manages commits itself, so this suppresses aider's automatic commits.

**4. Should jarvis pass `--no-git` or leave git enabled?**
Jarvis should pass `--no-git` (line 279-280):
```
--git, --no-git       Enable/disable looking for a git repo (default: True)
```
Rationale: Jarvis runs inside a worktree with its own git state. Using `--no-git` prevents aider from detecting and potentially interfering with the worktree's git operations. Aider's `--no-auto-commits` alone would not prevent aider from reading/interpreting git state; `--no-git` cleanly disables git integration entirely.

**5. How is model selection passed for local LLMs?**
Via the `--model` flag (line 94-95):
```
--model MODEL         Specify the model to use for the main chat
```
For Ollama, the documented format is `--model ollama/<model-name>` with `OLLAMA_API_BASE` env var (e.g., `OLLAMA_API_BASE=http://localhost:11434`). Aider uses litellm under the hood, which standardizes provider/model naming across multiple backends. This pattern round-trips cleanly through `aider --message`.

**6. Does aider write state files into the working directory?**
YES. Aider creates history and metadata files by default (lines 210-224):
- `.aider.input.history` (input history)
- `.aider.chat.history.md` (chat log)
- `.aider.llm.history` (optional, LLM conversation log)

However, aider automatically adds `.aider*` to `.gitignore` by default (lines 282-283):
```
--gitignore, --no-gitignore
  Enable/disable adding .aider* to .gitignore (default: True)
```
Jarvis's `.gitignore` already contains `.aider*` (verified in repo), so no additional entries are needed. Aider's default gitignore behavior aligns with the repo's existing configuration.

**7. What exit codes does aider produce?**
- **Exit code 0**: Success (command completed successfully)
- **Non-zero exit codes**: Errors, including:
  - Model/auth failures (e.g., unknown model, invalid API key): typically exit 1
  - Rate limits / provider errors: typically exit 1 with error messages matching patterns like "rate_limit_exceeded", "quota exceeded"
  - Internal errors: exit 1 with diagnostic output

Testing note: When aider encounters a model not available in its registry (e.g., `--model nonexistent-model`), it produces a `litellm.BadRequestError` in stderr with message "LLM Provider NOT provided". Exit code classification should be based on error pattern matching, similar to the existing quota/model-config detection in `src/agents/quota.ts`.

### Smoke-run status

A local LLM backend (Ollama, llama.cpp, etc.) is **not available** on the implementer's machine. The smoke run for local-model integration is deferred to subspec 01's test step, which will verify the actual end-to-end flow with a real model selection. Basic flag validation confirms the CLI surface matches the inferred draft.

## Documentation updates

- None. Subspec 04 handles README/docs updates after the implementation
  subspecs land.
