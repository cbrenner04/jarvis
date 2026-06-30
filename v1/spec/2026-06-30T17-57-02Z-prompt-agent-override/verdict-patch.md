## Verdict: refinements required before merge

### 1. Reject empty post-colon `--agent` values before worktree creation

`--agent <name>:` with an empty model is accepted today and reaches `createAgent` with `model: ""`. The spec treats malformed `--agent` as a pre-worktree CLI failure; run/plan already reject empty colon models via `validateAgentOrderEntries`. The shared `--agent <name>[:<model>]` spelling should fail consistently on prompt.

**Required outcome:** `--agent <valid-name>:` exits non-zero with a clear usage/validation error, before worktree creation or agent invocation. Automated coverage must include this case.

---

### 2. Align `v2/docs/v1-behaviors.md` seed wording with shipped surfaces

Line 195 says seed `per-run-agent-override-flag` tracks “future `run`/`plan`” override, but `run` and `plan` already accept `--agent` (`agents.md`, operator-runbook). The checked doc AC requires: prompt `--agent` satisfies verification now; the seed remains the tracker for remaining cross-mode override work—not future availability of run/plan flags.

**Required outcome:** `v1-behaviors.md` matches `operator-runbook.md` and `agents.md`: all three surfaces (`run`, `plan`, `prompt`) support per-run `--agent`; the seed tracks work beyond those surfaces.

---

### Not required for merge

- **Core `--agent` behavior** (pinned-first effective list, suffix dedup, quota/`model_config` fallthrough, telemetry `configured_model`, unsupported-subcommand rejection, bogus-agent pre-worktree rejection) matches spec and holds up.
- **`--repo` execution gap** (`cli.ts` resolves `--repo` then `promptCommand` re-resolves from cwd) predates this subspec; the combined-flag AC is parseArgs-only and is met. Fix separately if runtime `--repo` targeting is desired.
- **`--model` without `--agent` in `run()` vs `parseArgs`:** exits `1` before worktree; layering inconsistency only.
- **Integration test depth** (pinned all-quota exit `2`, CLI→`createAgent` model wiring): unit and `promptCommand` tests cover the main paths; additional hardening is optional, not blocking.
- **Spec task checkboxes** (`[ ]` while AC are `[x]`): process hygiene, not a runtime defect.
