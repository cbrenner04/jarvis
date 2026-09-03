---
name: structural-invariants-key-on-behavior-not-incidental-structure
---

# Structural-invariant tests key on incidental structure, so refactors red-gate on tests that still hold

## Problem

A recurring class, not four separate bugs: tests that assert a real invariant, but anchor it to something incidental — a line number, a symbol name, a file list, a hardcoded copy of a registry. The invariant keeps holding; the anchor breaks. Every extraction in the split-workflow-runner and split-daemon chains pays this tax, and each instance costs a red gate, a diagnosis, and a hand-fix on work that was correct.

Worse, the failure mode is sometimes silent rather than red: an anchor that stops matching can make the assertion vacuous instead of failing.

## Evidence

Six instances, all on refactors whose production behavior was sound:

1. **Line-keyed guard inventory** (#3330) — `execution-terminal-settlement-guard.test.ts` keyed `PERMITTED_TERMINAL_WRITES` on absolute line numbers, so any line shift in `workflow-runner.ts`/`write-loop.ts` — merges included — reddened it and stranded *unrelated* implements at ready-gate repair. Fixed by keying on `(file, writer/status, functionName)`.
2. **Whole-text keyword match** (#3348) — `classifyModuleBoundaryText` matched surface keywords across a bullet's entire text, so a doc path contributed `execution-loop` as a filename. Six sound plan drafts blocked, each hand-landed unchanged.
3. **Structure pin asserting against `""`** — a `daemon.ts` pin silently asserted against an empty string after an extraction moved its section markers. Vacuous, not red.
4. **Hardcoded observer list** (2026-09-02) — `diff-derived-mutation-verifier.test.ts` pinned the expected render-observer list for one prompt as a literal, so *registering an additional observer* failed a test whose subject is scoping ("invokes only that prompt's observer test file(s)"). Fixed by asserting against `resolveRenderObserverTests`.
5. **Symbol-name + file-list anchor** (2026-09-02) — `daemon-workflow-start.test.ts` locates sections by scanning a hardcoded list of daemon source files for `const handlePipelineRecoverHandler`. Subspec 03 both moved pipeline recovery to a new module *and* renamed the symbol to `pipeline_recover`, so the pin threw `no daemon module declares ...`. The assertion it guards (recovery routes through `admitWorkflowStart`, never touching registry/memory/`activeRuns`) was never in question.
6. **One-way structure assertion** (2026-09-02) — `workflow-runner-resume-structure.test.ts` asserted thirteen helpers are *absent* from `workflow-runner.ts` and never that they are present in the new module, so deleting one outright would pass exactly as well as moving it. Fixed by pairing with a presence assertion.

## Decisions

- A structural invariant asserts against the **thing it is about**: the registry/map/config it mirrors, or a resolved symbol, never a copied literal or a line number. Rules out hardcoding a value that already exists in the source of truth.
- Where a test must locate code by name, resolve the name through an exported identifier or a discovered file set, not a hand-maintained file list. Rules out anchors that a legitimate rename or module move invalidates.
- **A structural assertion that can no longer locate its subject must fail loudly**, never silently pass or assert against an empty string. Rules out the vacuous shape in instance 3.
- Absence assertions are paired with presence assertions when the invariant is "this moved". Rules out the one-way shape in instance 6.
- Prefer asserting the property (no direct registry access; observers are scoped to the changed prompt) over asserting the arrangement (this symbol sits in this file at this line).

## Acceptance criteria

- [ ] An audit lists every structural-invariant test under `v2/src/**` and `shared/**` — tests that read source files, pin symbol/file locations, or mirror a registry — and records for each whether its anchor is behavioral or incidental.
- [ ] Each anchor found to be incidental is either re-keyed to its source of truth or documented in the audit with why it must stay incidental — pinned by the audit artifact.
- [ ] Any structural assertion that cannot locate its subject fails with a named error rather than passing or comparing against an empty value — pinned by a test per surviving locator.
- [ ] `bun run typecheck` and the affected test-scope commands pass.

## Documentation updates

- `v2/docs/test-writing.md` — a section on structural-invariant tests: assert the property, anchor on the source of truth, fail loudly when the subject cannot be located, pair absence with presence.
