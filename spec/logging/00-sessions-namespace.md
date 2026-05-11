# 00 — Sessions directory & project key (namespace)

## Problem

Logging needs a stable **namespace per target repo**: the user chose the **`projects` registry key** from `~/.jarvis/config.json` (the string keyed alongside `{ root }`), not the path alone.

Today `findProjectForPath()` returns only `Project` and drops the registry key — implementations must recover the key while resolving spec → project.

## Decisions

- **Sessions directory**: `~/.jarvis/sessions/` (create when first needed, same bootstrap style as config dir).
- **Namespace**: exactly the matched project’s registry key (`config.projects[key]`).
- **Session file naming**: `{namespace}-{timestamp}.log` where `timestamp` is UTC ISO‑8601, minute precision acceptable (e.g. `2026-05-10T14:30Z`). If omitting seconds keeps parsing simpler elsewhere, specify one canonical form and use it everywhere.
- One **session** = one **`jarvis run`** invocation. One session file per run; append for the lifetime of that process.

## Tasks

- [ ] Add a constant for the sessions directory alongside existing `CONFIG_DIR` / paths (avoid ad‑hoc strings scattered in commands).
- [ ] Extend config helpers so callers can resolve **both** `key` and `root` for an absolute path (e.g. return `{ key: string; root: string }` or introduce a sibling API). Preserve existing call sites semantics.
- [ ] Implement safe directory creation under `~/.jarvis/sessions/` when opening a session log.
- [ ] Tests: temp config dir injection; overlapping project roots still resolve to the longest root; resolved key matches the registered name.

## Acceptance criteria

- `bun test` passes; typecheck passes.
- No feature work for server or tagging here — only path/key plumbing and filesystem layout contract.

## Documentation updates

- `README.md`: mention `~/.jarvis/sessions/` and that session files are keyed by registry project name.
