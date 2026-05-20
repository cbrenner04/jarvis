---
name: plan-refine-human-gate
---

## 1. Draft an intent file (inline only)

```sh
jarvis plan "one liner"
```

One agent turn expands the one-liner into a rough `intent.md` and exits. Not a verbatim copy of the quoted string — a quick, messy first draft. Does **not** run Phase 0, draft, review, or the committed plan worktree pipeline. No prescribed structure beyond what that single turn writes.

Operator edits the file (or not), then continues when ready.

## 2. Plan from an intent file

```sh
jarvis plan /path/to/spec/.../intent.md
```

Runs committed plan mode from that file:

1. **Phase 0** — intent refinement (refine turns, naming, `plan: refine`)
2. **Stop** — `## Blocker` on `intent.md`, intent-only draft PR, exit before Phase 1
3. Human clears blocker on the PR
4. **`jarvis plan --resume-draft …/intent.md`** — Phase 1 (draft) + review

## Decisions

- Inline = one-turn intent draft; file path = full plan pipeline from existing `intent.md`.
- Phase 0 gate is universal for file-based fresh runs (not opt-in).
- `--resume-draft` requires `## Blocker` cleared first.

## Out of scope (first cut)

- `modes.plan.commit: false`
- Typed blockers
- `jarvis plan <intent.md>` doubling as resume (use `--resume-draft`)
