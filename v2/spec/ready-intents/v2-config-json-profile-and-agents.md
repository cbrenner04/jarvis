---
name: v2-config-json-profile-and-agents
---

# machineProfile and agents move into ~/.jarvis/config.json

Add `machineProfile` (`home` | `work`, open string, no enum hardening) and `agents` (ordered fallback chain) to `~/.jarvis/config.json` alongside v1 `projects`; v1 ignores unknown top-level keys. Resolve the active machine profile at startup: read `machineProfile` from `~/.jarvis/config.json`, then load `config/machines/<profile>.json` via the loader from [[v2-repo-machine-profile-files]]. Missing `machineProfile` or missing profile file is a hard error, not a silent fallback to v1 defaults. `jarvis config set-agents` writes `agents` to `~/.jarvis/config.json`; `config show`/`config path` reflect it. Retire `~/.jarvis/v2.json` entirely — `agents` never lives in the repo machine files.

## Prerequisites

- `jarvis config set-agents` and a machine-config loader exist (`v2.json` today).
- A profile-name-keyed loader for `config/machines/<profile>.json` exists.
