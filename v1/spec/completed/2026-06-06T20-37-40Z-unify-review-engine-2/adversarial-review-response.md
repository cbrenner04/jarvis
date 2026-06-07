# Response to adversarial review — defense of the implementation

> Rebuttal to [adversarial-review.md](adversarial-review.md). Persisted record.
> Reviewed at: 64d0294 · Date: 2026-06-06
>
> Position: the implementation is sound and ships as-is. Findings #2 and #3 are
> intended/cosmetic; #1 is a real-but-negligible edge whose "fix" trades one
> ambiguity for another. None block merge.

## Finding 1 — raw exit-code propagation: transparency beats a blanket `1`

The review calls it a regression that the runner returns `result.exitCode` instead of `1`. The reverse framing is fairer: the **old code destroyed information**. Two unrelated failures — a transient network blip and a malformed-flag crash — both collapsed to `1`, so the operator's only diagnostic was stderr. The shared runner surfaces the real code, which is strictly more useful in the common case.

The collision worry rests on a chain of conditions that rarely all hold:

1. The failure must reach `kind: "error"` at all. The agent classifier peels off **quota** and **model_config** *before* the error branch, so `error` is only the residue the classifier couldn't bucket.
2. That residual failure must exit with exactly `2`, `3`, or `7`. The three supported CLIs (`claude`, `codex`, `cursor`) exit `1` on ordinary errors; `2/3/7` are not their failure codes. This is a hypothesized input, not an observed one.
3. The consequence is a **mislabeled summary token / process code** — not data loss, not a bad commit, not a skipped gate. The run still *stops on a hard error*, which is exactly the spec's stated contract ("hard errors stop without silent continuation").

And recall the deployment reality this repo is explicitly built for (CLAUDE.md): **single operator, no npm publish, no CI keyed on exit codes**. There is no automated consumer that branches on `2` vs `7`; the human reading the run also reads the stderr that carries the true error. The blast radius of the worst case is one confusing word in a summary the author wrote and reads.

The proposed mitigation — "clamp non-reserved codes to 1" — is not free. It reintroduces exactly the information loss we removed, and "non-reserved" is itself a moving target as reserved codes evolve. The current behavior is deliberate and pinned by `run.test.ts:256`. Keeping real codes is the defensible default; if a specific agent is ever observed emitting `2/3`, map *that* code at *that* adapter rather than flattening everything globally.

## Finding 2 — summary reason: cosmetic, and arguably more correct

This finding concedes its own severity: "Behavior … is unchanged — only the telemetry/summary reason is miscategorized." Every operator-visible **artifact** is identical — the revert happens, the blocker commit lands, the PR comment posts, the exit code is the same, and stderr still prints `plan: boundary violation detected …`, the offending paths, and `plan: blocked`. Only a single summary token moved.

And the new bucket is defensible on the merits:

- A **write-boundary violation** *is* the agent misbehaving — writing where it was told not to. Labeling that `agent-error` is more honest than `blocker`, which should mean "the agent deliberately raised a blocker," not "the harness caught the agent out of bounds." The old label conflated those two very different events.
- A **validation failure** is likewise the agent producing structurally invalid output. `agent-error` describes that better than the catch-all `error`.

So this isn't a regression so much as a tightening of an over-broad label, with zero functional effect. No downstream code keys off these tokens.

## Finding 3 — per-pass agent reset: the intended, cleaner model

The review flags this then immediately notes the commit message says it's intentional — because it is, and it's the better design.

- **A pass is a fresh review.** Coupling pass 2's agent selection to pass 1's quota luck is the surprising behavior; the reset removes hidden cross-pass state. Each pass independently walks the configured fallback order, which is what the config *says* it does.
- **Quota is not permanent within a run.** Passes are separated by real wall-clock time (agent work + `ready` gates between them). A primary exhausted in pass 1 can be available again by pass 2; resetting lets the run climb back to the preferred agent instead of being stranded on a fallback for the rest of the review.
- **The cost is bounded and cheap.** Worst case is one extra spawn per pass, and a quota spawn fails *fast* (detected from stderr/exit, no real work performed). At the default 2 passes that's at most one quick retry — a negligible price for correct, preferred-agent selection.

The old permanent-`shift()` optimized for a case (persistent quota) that the new lenient/porcelain-guarded quota handling already treats as recoverable. Resetting is consistent with that direction.

## Bottom line

The adversarial pass turned up no correctness defect with operator-visible consequences: no bad commits, no skipped gates, no corrupted specs, no silent continuation. What remains is one low-probability cosmetic edge (#1) and two intentional, arguably-improved labels/behaviors (#2, #3). The refactor preserves every artifact-level behavior, keeps the timeout watchdog, guards telemetry double-records, and is covered by 97 passing tests. Ship it.
