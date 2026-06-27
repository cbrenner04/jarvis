## Verdict

### Required fixes before merge

**1. Already-registered project never receives the runbook**

`init.ts:54` returns 0 immediately when a project is already registered at the same root, before the runbook-write block at line 79. A project registered prior to this feature can never receive `OPERATOR_RUNBOOK.md` by re-running `jarvis init`, even when the file is absent. The spec states the write must occur when the file is absent regardless of registration state ("registration still happens either way" covers both paths). The runbook-write check must execute on the already-registered early-return path, not only on the fresh-registration path.

**2. Known-gotchas entries carry placeholder issue URLs**

`runbook-generator.ts:118,120` link gotcha entries to `https://github.com/cbrenner04/jarvis/issues` (the issues listing) via `#TODO-symlink-gotcha` and `#TODO-init-idempotent` anchors. The spec AC is explicit: "every gotcha entry links to a jarvis issue URL." A listing-page URL with a `#TODO` fragment is not a specific issue link. Resolve the actual issue numbers from the jarvis repo (the spec names `v1/docs/operator-runbook.md` as the source; check the intake issue #598 and related issues) and use specific `/issues/<N>` URLs.

**3. Typo in doc comment**

`stack-inference.ts:29`: "Syncronous" → "Synchronous". The doc-comment is part of the helper's contract documentation required by subspec 00.

---

### Minor (fix opportunistically, not blocking)

- `cli.ts:81` top-level usage one-liner still reads "Register the current target repo." — omits the runbook scaffold. The subcommand help at line 117 is correct; the one-liner update is better UX but the AC is narrowly satisfied.
- `init.ts:83–86` unreachable error branch after successful `registerProject` — dead code, adds confusion without function.
- `runbook-generator.ts:54,129` couples the gate-section conditional to the display string `"not configured"` rather than the raw `ctx.project.readyCommand` value — minor coupling.