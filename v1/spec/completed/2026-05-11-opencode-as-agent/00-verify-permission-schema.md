# 00 — Verify opencode permission schema

## Problem

The follow-up subspec `04-opencode-permission-stanza.md` writes a `permission`
block into `~/.config/opencode/opencode.json` to pre-allow file edits, writes,
and most bash from jarvis-driven non-interactive runs. The schema for that
block is inferred from an existing local config that uses `permission.skill`
and from per-agent `permissions` keys (`bash`, `edit`, `write`) seen in the
same file. Before writing code that emits this block, the schema must be
verified against opencode's own configuration schema so the example does not
ship guessing at field shapes.

## Decisions

- The canonical schema source is `https://opencode.ai/config.json` (the
  `$schema` URL embedded in user configs).
- This subspec produces no code changes. Its output is a verified, concrete
  example permission block recorded in this file under
  `## Verified schema` for subsequent subspecs to copy.
- If the verified schema differs materially from the inferred draft below,
  update the draft and call out the differences before continuing.

## Inferred draft (to verify, not to ship)

```json
{
  "permission": {
    "edit": "allow",
    "write": "allow",
    "bash": {
      "git push*": "ask",
      "git push --force*": "deny",
      "rm -rf /*": "deny",
      "rm -rf ~*": "deny",
      "sudo*": "deny",
      "curl*": "ask",
      "wget*": "ask",
      "npm publish*": "deny",
      "*": "allow"
    }
  }
}
```

Open questions to answer during verification:

1. Does the top-level `permission.bash` accept a glob-keyed map of
   `allow` / `ask` / `deny` values, or only a single string value?
2. What is the precedence order between specific patterns and the `"*"`
   wildcard? Is it longest-pattern-wins, first-match-wins, or something
   else?
3. What other top-level keys (e.g. `edit`, `write`, `read`, `webfetch`) does
   the schema define, and what are the valid values for each?
4. Are there permission keys that should be added to keep the posture in
   line with the existing `spec/2026-05-11-permissions/00-default-posture.md` (e.g.
   explicit network egress controls)?

## Tasks

- [ ] Fetch `https://opencode.ai/config.json` and locate the `permission`
      definition (or follow `$ref` chains until the concrete shape is
      visible).
- [ ] Cross-check against the opencode CLI's own permission documentation if
      the schema references external docs.
- [ ] Record findings under a new `## Verified schema` section in this file,
      including:
      - The exact field shape (`allow | ask | deny` strings, maps, etc.).
      - The precedence rule for `bash` glob matches.
      - A finalized `permission` JSON block that subspec 04 will write into
        `~/.config/opencode/opencode.json`.
- [ ] Flag any inferred-draft items that proved wrong so subspec 04 does not
      copy stale assumptions.

## Acceptance criteria

- This file has a `## Verified schema` section containing a finalized
  `permission` JSON example for `~/.config/opencode/opencode.json`.
- The example matches `https://opencode.ai/config.json` without warnings or
  errors when the file is opened in an editor with JSON schema validation.
- Any deviation from the inferred draft is called out explicitly so reviewers
  see what changed.

## Documentation updates

- None. Subspec 05 handles README/docs updates after the implementation
  subspecs land.

## Verified schema

Sources checked:

- `https://opencode.ai/config.json`, the schema URL embedded in opencode
  configs. The local sandbox could not resolve `opencode.ai`, but the indexed
  schema confirms that `permission` is a top-level config field and that
  per-agent config also has a `permission` field.
- Official opencode permission docs at `https://opencode.ai/docs/permissions/`.

Field shape:

- `permission` may be one action string (`"allow"`, `"ask"`, or `"deny"`) to
  set every permission at once.
- `permission` may also be an object. Each property key is a permission/tool
  name or wildcard pattern, and each property value is either:
  - one action string (`"allow"`, `"ask"`, or `"deny"`), or
  - a pattern map whose keys match the tool input and whose values are action
    strings.
- Granular pattern maps are valid for `bash`; the command patterns are glob
  strings such as `"git push*"` or `"rm -rf /*"`.
- Opencode evaluates granular pattern maps by pattern match with
  last-matching-rule-wins semantics. Put catch-all `"*"` entries first, then
  more specific overrides after them.
- Documented permission keys include:
  - `read`: reading files; matches file paths.
  - `edit`: all file modifications, including edit, write, and patch tools;
    matches file paths.
  - `glob`: file globbing; matches the glob pattern.
  - `grep`: content search; matches the regex pattern.
  - `list`: directory listing; matches directory paths.
  - `bash`: shell execution; matches the command.
  - `task`: subagent task calls; matches the subagent name.
  - `skill`: skill loading; matches the skill name.
  - `lsp`: LSP/code-intelligence operations.
  - `question`: asking the user questions during execution.
  - `webfetch`: URL fetching; matches the URL.
  - `websearch`: web search; matches the query.
  - `external_directory`: tool calls that touch paths outside the working
    directory; matches the external path.
  - `doom_loop`: repeated identical tool-call guard.
  - `todoread` and `todowrite`: todo-list tools.
  - `codesearch`: semantic/external code search.

Finalized permission block for subspec 04:

```json
{
  "permission": {
    "edit": "allow",
    "webfetch": "ask",
    "websearch": "ask",
    "codesearch": "ask",
    "external_directory": "ask",
    "bash": {
      "*": "allow",
      "curl*": "ask",
      "wget*": "ask",
      "npm install*": "ask",
      "bun add*": "ask",
      "pnpm add*": "ask",
      "yarn add*": "ask",
      "git push*": "ask",
      "git push --force*": "deny",
      "git clean*": "deny",
      "git reset --hard*": "deny",
      "rm -rf /*": "deny",
      "rm -rf ~*": "deny",
      "rm -rf $HOME*": "deny",
      "sudo*": "deny",
      "npm publish*": "deny"
    }
  }
}
```

Differences from the inferred draft:

- The `"*": "allow"` bash fallback moved to the top of the `bash` map. Keeping
  it last would override every earlier `ask` or `deny` rule.
- Added `webfetch`, `websearch`, and `codesearch` as explicit `"ask"` rules for
  network-facing opencode tools, matching the safe-edits posture's network
  egress gate.
- Added `external_directory: "ask"` so writes outside the agent cwd still
  require approval.
- Added package-install and destructive git command patterns to the bash map.
- Removed the separate top-level `write` key. `edit` is the documented
  permission for all file modifications, including write and patch operations,
  so subspec 04 should treat `edit` as the canonical file-modification
  permission.
