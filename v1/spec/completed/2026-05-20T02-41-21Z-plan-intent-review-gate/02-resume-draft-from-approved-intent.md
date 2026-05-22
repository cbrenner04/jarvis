# 02 - Resume draft from approved intent

## Goal

After Phase 0 stopped with a blocker (subspec 01), the human edits `intent.md` on the PR and clears `## Blocker`. Then:

```sh
jarvis plan --resume-draft spec/<spec-dir>/intent.md
```

runs Phase 1 (draft) and review on the existing plan branch/PR.

## Decisions

- Explicit `--resume-draft`; plain `jarvis plan <intent.md>` remains a fresh Phase 0 run.
- Committed plans only in this cut.
- Resume fails while `## Blocker` remains.
- `--resume spec/.../index.md` stays post-draft only.

## Acceptance criteria

- [x] `--resume-draft` runs draft + review after blocker cleared; fails if blocker present.
- [x] `jarvis plan spec/.../intent.md` without `--resume-draft` always starts at Phase 0 (fresh run).
- [x] `docs/plan-mode.md` documents the operator flow: inline one-turn draft → `plan intent.md` → clear blocker → `--resume-draft`.

## Documentation updates

- Document `--resume-draft` and the full operator flow in `docs/plan-mode.md`.
