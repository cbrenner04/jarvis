# Specless prompt invocation

`jarvis1 --prompt` is a single-pass mode that sends an agent a prompt without a spec file, captures its output, and optionally commits and pushes the results. It bridges ad-hoc one-shot agent requests with Jarvis's git and quota fallback machinery.

## Invocation

```sh
jarvis1 prompt [--repo <name|path|url>] [--agent <name>[:<model>]] [--model <model>] <text>
```

The `<text>` argument is treated as the prompt. If it contains spaces or special characters, quote it:

```sh
jarvis1 prompt "fix the broken test in test/auth.test.ts"
```

### Flags

- `--repo <name|path|url>` — optional project specifier (name, path, or GitHub URL). If omitted, resolution falls back to parent `.git` directory detection.
- `--agent <name>[:<model>]` — pin the primary agent for this invocation without editing config. Remaining `modes.prompt.agentOrder` entries follow in config order; a duplicate of the pinned name is skipped.
- `--model <model>` — model for the pinned agent when `--agent` omits `:model`. When both `--agent <name>:<model>` and `--model` are set, the colon form wins.
- `--cwd` — **not allowed** in prompt mode; the agent always runs in the resolved project root.

## Preflight rejections

Prompt mode fails immediately (exit 1) under any of these conditions:

- **Git is disabled** (`git: false` in config): prompt mode requires git/GitHub integration and cannot run in no-git contexts.
- **Project not registered**: the resolved project path is not registered with `jarvis1 init`, and cwd-based fallback fails.
- **GitHub CLI not authenticated**: `gh auth status` fails.

## Worktree and branch naming

Prompt mode creates a temporary worktree under `.worktree/<timestamp>-prompt-<nonce>/` on a corresponding branch with the same name:

```
.worktree/2026-06-06T14-30-25-prompt-a7k3m2/
```

The worktree is derived from the project root and includes a 6-character random nonce to avoid collisions on repeated invocations. The worktree path and branch are both `<timestamp>-prompt-<nonce>` (no additional naming from the prompt text).

## Single-pass execution

Prompt mode is strictly single-pass: it invokes agents from the effective prompt agent list in order until one succeeds or the chain ends. Without `--agent`, that list is `modes.prompt.agentOrder`. With `--agent`, the pinned agent runs first, then any remaining config entries (deduped):

1. Load the prompt using the shared template system.
2. Try agents in configured order. Fallback-eligible outcomes (`quota`, `model_config`) advance to the next agent; generic `error` (exit 3) and iteration timeout (exit 8) halt immediately on the failing agent.
3. On successful run, check for git diffs:
   - **No diffs**: print the agent's output to stdout, then emit a summary block and outcome line, and exit 0 (no commit or PR).
   - **Diffs present**: commit all changes, push, and open a draft PR; emit a summary block and PR URL outcome line, then exit 0.
4. When no agent succeeds:
   - Exit 2 only when every attempted agent returned `quota` (all-agents quota exhaustion).
   - Exit 3 when a non-quota fallthrough (`model_config`) ended the chain, or when the final agent failed without all-quota exhaustion.

## Diff vs. no-diff outcomes

### No diffs

If the agent succeeds but makes no changes to the repository:

1. The agent's stdout output is printed first.
2. A summary block is emitted, showing usage/cost and duration.
3. An outcome line is printed stating "No changes were made."
4. Exit code is 0 and no git operations occur.

This is useful for read-only queries or when the agent output is the primary deliverable.

### Diffs present

If git reports any modified or new files after the agent run:

1. **Commit**: all changes are staged and committed with:
   - Subject: first non-empty line of the prompt (ellipsized to ~72 characters).
   - Body: full prompt text + `Jarvis-Agent: <label>` trailer.

2. **Push**: changes are pushed to `origin/<branch>`.

3. **PR**: a draft PR is opened with:
   - Title: same as commit subject.
   - Base: detected default branch (`main`, `master`, etc.).
   - Head: the temporary prompt branch.
   - Body: full prompt text + attribution footer.

4. **Summary and outcome**: A summary block is emitted showing usage/cost and duration. An outcome line is printed with the created PR URL.

## Harness-owned commit and PR shape

All commits created by prompt mode include a `Jarvis-Agent: <agent-name>` trailer, matching patch-mode commit conventions. This documents which agent produced the change.

The PR body is always:
```
<full-prompt-text>

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Manual narrative insertion (as supported in patch-mode PRs) is not supported in prompt mode. The PR body is purely generated and not user-editable.

## Exit codes

| Code | Reason | Notes |
| --- | --- | --- |
| 0 | Success | Agent succeeded; output printed (no-diff) or PR opened (diffs). |
| 1 | Error | Git disabled, project not registered, GitHub auth failed, commit/push/PR creation failed, or other hard error. |
| 2 | Quota exhausted | Every attempted agent returned quota-related errors. |
| 3 | Agent/model failure | Generic agent error, model-configuration fallthrough without success, or a mixed chain that did not end in all-quota exhaustion. |
| 8 | Timeout | Iteration timeout (`iterationTimeoutMs`) fired during agent execution. |

## Configuration

Prompt mode agent order lives in `modes.prompt.agentOrder`:

```json
{
  "modes": {
    "prompt": {
      "agentOrder": [
        { "agent": "claude", "model": "haiku" },
        { "agent": "codex", "model": "gpt-5.3-codex" },
        { "agent": "cursor", "model": "Composer 2" }
      ]
    }
  }
}
```

If `modes.prompt` is not specified in the config, it defaults to a copy of `modes.patch.agentOrder`.

### Set prompt agent order

```sh
jarvis1 config set-prompt-order claude:haiku,codex:gpt-5.3-codex
```

This replaces the entire `modes.prompt.agentOrder` with the provided comma-separated list of `agent:model` pairs.

## Shared timeout and quota behavior

Prompt mode respects the same timeout and quota configuration as patch mode:

- `iterationTimeoutMs` (default 10 minutes): watchdog timeout per agent invocation.
- `quotaFallback` (strict/lenient): weak quota upgrade policy.
- `weakQuotaExitCodes`: exit codes treated as weak-quota signals under lenient mode.

Unlike patch mode, prompt mode allows lenient weak-quota upgrades on every iteration (no "progress gate" restriction), since there is no multi-subspec loop.
