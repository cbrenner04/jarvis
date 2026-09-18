---
id: implement.rules
behavior: implement-rules
kind: fragment
revision: 14
---
# Implement

Execute the active spec only.

## Scope
- Modify only files named by spec.
- Do listed steps only. No add/remove/reorder/reinterpret.
- Read only files needed for spec.
- No unrelated refactors/abstractions.
- One repo per iteration.
- Match style. No unrelated formatting.

## Iteration
- Work the harness-injected active subspec only.
- Subspec acceptance criteria must be under an exact `## Acceptance criteria` heading (case-sensitive, level-2).
- Blockers must be under an exact `## Blocker` heading (case-sensitive, level-2).
- Inside the active subspec, tick `- [ ]` acceptance-criteria items as you actually satisfy them. Do not tick speculatively. Do not tick anything else. Tick every confirmed-satisfied criterion as a mandatory final step; if criteria are already `- [ ]` on entry but their work is already complete, re-verify and then tick—never report "already done" and stop without ticking.
- Do not edit `index.md`. Jarvis flips the index checkbox itself when all acceptance criteria are checked.
- Do not run `git commit` or otherwise create commits. Jarvis owns staging and committing.
- Jarvis re-invokes for the next iteration; iterate the same subspec until all its acceptance criteria are checked.
- Use commands from target repo `AGENTS.md`; no equivalents.
- Acceptance criteria flagged human-only (`(Manual)`, "visual inspection only", "no automated guard") are operator-verified: implement them, run the automated gate, leave them unchecked, and do not attempt in-sandbox visual verification (no dev-server port bind). Do not append a `## Blocker` for human-only criteria.
- When target-repo guidance documents test suites that cannot run inside the agent sandbox and are run by the harness outside it, do not run them: a criterion naming only such suites (alongside checks you can run) is ticked once your in-sandbox checks pass. Sandbox permission or spawn failures (e.g. `EPERM`) in those suites are never a reason to append `## Blocker`.
- Run the tests target-repo guidance prescribes for the surfaces you touched (paths changed since the merge base); never the full suite unless that guidance resolves to it — it costs the iteration budget.
- Skip tests when the iteration changed only human-facing prose; run the typecheck only when typed source changed.
- If a scoped test run fails, re-run it once the way the target repo's `AGENTS.md` prescribes for flake recovery before treating the failure as real or grounding a blocker; only a reproducing failure is real.
- Leave tree compiling.

## Stop
- Unclear: append `## Blocker` to spec; stop. Jarvis will detect it, commit any progress, and exit with code 7. Appending `## Blocker` means the final line must be `blocked`.
- Mid-edit red (before all edits complete): not pre-existing breakage; finish edits and re-run.
- Mid-edit red: do not raise pre-existing/unrelated/baseline-failures blockers; harness validates and rejects unconfirmed claims.
- Repeated failure (after edits complete): record failure in spec; stop.
- No TODOs. Put follow-up in spec.
- New dependency? Edit `package.json`/lockfile, record the decision in spec, and continue. Dependency installs are harness-managed and run outside the sandbox after the iteration. In-sandbox install failures are expected and not grounds for a `## Blocker`.
