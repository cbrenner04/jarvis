# 00 - Project agent-config loader

Add the v2-owned loader for the per-machine outer agent fallback list described
in [`agent-model-config.md`](../../docs/agent-model-config.md) ("Storage
split"). No model/rung data — availability/quota chain only.

## Decisions

- New file `~/.jarvis/projects.json`, keyed `{ "projects": { "<projectName>": { "agents": string[] } } }` — `agents` is an ordered list of agent-adapter name strings (availability/quota chain only, no model data); separate from v1's `~/.jarvis/config.json`; rules out coupling v2 loading to v1's versioned schema/migration logic.
- Missing file or missing project entry returns `undefined` (no override), not `[]` or an error — v2 has no project-registration step yet, so "unregistered project" isn't a load failure.
- Any structurally invalid `projects.json` (unparseable JSON, `projects` not an object, a project's `agents` not an array, an `agents` array with non-string entries, duplicate names, or an empty `agents` list) is a hard load error — only true absence (missing file, missing project key) returns `undefined`; this keeps "absent" and "present-but-broken" unambiguous instead of silently treating garbage config as "no override."
- No validation against a fixed agent-name enum — rules out coupling to v1's `AGENT_NAMES` union; v2 agent adapters are an open set per `agent-model-config.md`.

## Task checklist

- [ ] Add `v2/src/execution/project-agent-config.ts` exporting `PROJECT_AGENT_CONFIG_PATH` (`~/.jarvis/projects.json`) and `loadProjectAgents(projectName, configPath?)`.
- [ ] Co-located test `v2/src/execution/project-agent-config.test.ts` using temp file paths (no writes under real `~/.jarvis`).

## Acceptance criteria

- [ ] `loadProjectAgents(name, path)` returns `undefined` when no file exists at `path`.
- [ ] `loadProjectAgents(name, path)` returns `undefined` when the file exists but has no `projects.<name>` entry.
- [ ] `loadProjectAgents(name, path)` returns the ordered `agents` array when the project entry is present.
- [ ] `loadProjectAgents` throws when a project's `agents` list contains a duplicate name.
- [ ] `loadProjectAgents` throws when a project's `agents` list is present but empty.
- [ ] `loadProjectAgents` throws when `projects.json` is structurally invalid (unparseable JSON, `projects` not an object, or a project's `agents` not an array of strings) rather than returning `undefined`.

## Documentation updates

- `v2/docs/agent-model-config.md`: pin the on-disk filename (`~/.jarvis/projects.json`) at the "Storage split" row, which currently names only the directory; add a one-line note distinguishing it from v1's `~/.jarvis/config.json` `modes.patch.agentOrder` (both are per-machine outer-fallback stores, but v1's governs patch-mode runs and v2's governs `write`/`run start`).
