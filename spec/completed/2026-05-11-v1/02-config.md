# 02 — Config bootstrap

Define the `~/.jarvis/` config layout and the load/bootstrap logic. No CLI surface yet — that comes in 03 and 05.

## Layout

```
~/.jarvis/
  config.json
```

`config.json` schema (v1):

```ts
type AgentName = "claude" | "codex" | "cursor";

type Project = {
  root: string;          // absolute path to the target-repo root
};

type Config = {
  version: 1;
  agentOrder: AgentName[];
  projects: Record<string, Project>;   // key = project name (basename of root by default)
};
```

Default contents on first bootstrap:

```json
{ "version": 1, "agentOrder": ["claude", "codex", "cursor"], "projects": {} }
```

## Tasks

- [ ] `src/config.ts` exports:
  - `CONFIG_DIR` (resolved from `$HOME`)
  - `CONFIG_PATH`
  - `type Config`
  - `loadConfig(): Config` — bootstraps the dir + default file if missing, then reads + validates.
  - `writeConfig(c: Config): void`
- [ ] Bootstrap is idempotent; calling `loadConfig()` on a clean machine creates the dir + default file and returns it. Calling it again does nothing destructive.
- [ ] Helpers: `registerProject(name: string, root: string): void` and `findProjectForPath(p: string): Project | undefined` (returns the registered project whose `root` is an ancestor of `p`).
- [ ] Validation rejects unknown agents, missing `version`, non-absolute project roots, and duplicate roots. On invalid config, throw with a clear message naming `CONFIG_PATH`.
- [ ] Tests: bootstrap-from-empty, load-existing, reject-invalid. Tests use a temp dir injected via an optional override (e.g. `loadConfig({ dir })`) so they don't touch the real `~/.jarvis/`.

## Acceptance criteria

- `bun test` covers all three cases.
- No code outside `src/config.ts` reads `~/.jarvis/` directly.

## Documentation updates

- Add a "Configuration" section to `README.md` documenting the layout, schema, and that the dir is auto-created.
