# 00 - Tighten createAgent factory signature

## Problem

`createAgent` in `src/agents/factory.ts` has three inconsistencies that all stem from treating `model` as `string | undefined`:

1. Claude/codex/cursor branches do `model ? { model } : {}` — a no-op guard, because `model` is always defined by the time the factory is called.
2. Opencode and aider branches `throw new Error("... requires model to be configured")` — also unreachable, for the same reason.
3. The factory parameter type itself (`model: string | undefined`) hides the invariant that `src/config.ts` enforces during config load: every agent entry has a non-empty, known-priced `model`.

The result is per-agent branches that all do slightly different things while pretending to handle a case (`!model`) that cannot occur.

## Decisions

- **Signature becomes** `createAgent(agentName: AgentName, model: string, opts?: CreateAgentOptions): Agent`. `opts` defaults to `{}` internally (or is destructured with a default) so existing two-argument call sites keep working.
- **Per-agent constructor option types are left alone.** `ClaudeAgentOptions.model?: string` and the equivalents on the other agents stay optional so direct-construction tests (`test/agents/claude.test.ts`, etc.) continue to compile. Only the factory call site is tightened.
- **`outputFormat` plumbing is unchanged.** The factory keeps forwarding `opts.claude?.outputFormat` into `ClaudeAgent` when provided. Patch mode keeps reading `getClaudeOutputFormat(cfg)` and passing it in. Plan modes keep passing nothing and inheriting the `ClaudeAgent` default (`"json"`). No config schema changes.
- **No agent constructor logic changes.** Each branch becomes `new XAgent({ model, ...maybeClaudeOpts })` (or just `new XAgent({ model })` for non-claude agents).

## Tasks

- Edit `src/agents/factory.ts`:
  - Change the `model` parameter type from `string | undefined` to `string`.
  - Remove the `model ? { model } : {}` spreads in the claude/codex/cursor branches; pass `{ model }` directly (plus `outputFormat` for claude when present).
  - Remove the `if (!model) throw ...` guards in the opencode and aider branches; construct directly with `{ model }`.
- Confirm via type-check that every existing `createAgent(...)` call site in `src/modes/patch/run.ts` and `src/modes/plan/{review,interview,name-only,draft}.ts` continues to compile (each already passes `entry.model`, which the config layer guarantees to be a string).
- Do **not** change `ClaudeAgentOptions`, `CodexAgentOptions`, `CursorAgentOptions`, `OpencodeAgentOptions`, or `AiderAgentOptions`.
- Do **not** change the `outputFormat` config field, its getter (`getClaudeOutputFormat` in `src/config.ts`), or how patch mode resolves and passes it.
- Update `test/plan-draft-hard-error-continue.test.ts` (and any other test that calls `createAgent` with an explicitly-`undefined` model) so the call matches the new signature. Tests that construct agent classes directly (e.g. `test/agents/claude.test.ts`) must be left untouched.

## Acceptance criteria

- [ ] `src/agents/factory.ts` exports `createAgent(agentName: AgentName, model: string, opts?: CreateAgentOptions): Agent` with `model` typed as `string` (not `string | undefined`).
- [ ] No branch inside `createAgent` contains a `model ? { model } : {}` spread or a `model ? ... : ...` conditional on `model`.
- [ ] No branch inside `createAgent` throws on `!model`; the opencode and aider branches construct directly with `{ model }`.
- [ ] The claude branch still forwards `opts.claude?.outputFormat` to `ClaudeAgent` when provided, and omits it otherwise.
- [ ] `CreateAgentOptions` retains its `claude.outputFormat` shape; no fields are added or removed.
- [ ] `ClaudeAgentOptions`, `CodexAgentOptions`, `CursorAgentOptions`, `OpencodeAgentOptions`, and `AiderAgentOptions` are unchanged.
- [ ] `src/config.ts` is unchanged with respect to `outputFormat` (field, schema, and getter all preserved).
- [ ] The project type-checks cleanly with no `createAgent` call site needing a non-null assertion or cast on `model`.
- [ ] Any test that previously passed `undefined` for `model` to `createAgent` is updated to match the new signature; tests that construct agent classes directly are unchanged.

## Documentation

- No user-facing documentation changes are required. If a comment in `src/agents/factory.ts` references the old "may be undefined" contract, update or remove it; otherwise no doc edits are needed.
