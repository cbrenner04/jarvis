---
id: patch.rules
behavior: patch-rules
kind: fragment
revision: 5
---
# Patch Mode

Execute active spec only.

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
- Jarvis re-invokes for the next iteration; iterate the same subspec until all its acceptance criteria are checked.
- Use commands from target repo `AGENTS.md`; no equivalents.
- Run tests strategically: skip `bun run test` only when the iteration changed nothing under tested paths (no source files, test files, prompt fragments, or fixtures — only human-facing prose). Run `bun run typecheck` only when any typed source changed. This avoids flake exposure on docs-only iterations with zero signal.
- If `bun run test` fails, re-run once serially as `bun test` (without `--parallel`, no path/filter args) before treating the failure as real or grounding a blocker; only a serially-reproducing failure is real. This recovers from parallel-load flakes without hiding genuine breakage.
- Leave tree compiling.

## Stop
- Unclear: append `## Blocker` to spec; stop. Jarvis will detect it, commit any progress, and exit with code 7.
- Mid-edit red (before all edits complete): not pre-existing breakage; finish edits and re-run.
- Mid-edit red: do not raise pre-existing/unrelated/baseline-failures blockers; harness validates and rejects unconfirmed claims.
- Repeated failure (after edits complete): record failure in spec; stop.
- No TODOs. Put follow-up in spec.
- New dependency? Record decision in spec; stop.
