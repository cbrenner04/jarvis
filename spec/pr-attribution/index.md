# PR-level agent attribution

repo: git@github.com:cbrenner04/jarvis.git

When Jarvis opens a draft PR (`ensureDraftPr` in `src/pr.ts`, called from
`src/modes/patch/run.ts`), the body is whatever the underlying agent
produced via `buildPrBodyPrompt`. Nothing in the PR records which
agent/model actually wrote the work. That information is useful for
reviewers (different models produce visibly different code) and for
post-hoc analysis of "which model is doing the bulk of this repo's
changes." It's also low-cost to add: Jarvis already knows the agent
name and configured model at the call site.

This spec adds a one-line attribution footer to the PR body, appended
by Jarvis itself rather than asked of the agent.

## Decisions

- **Granularity: PR body only.** No per-commit `Co-Authored-By` trailer,
  no WIP-commit attribution, no separate metadata file. One line in the
  PR description.
- **Format:** plain-text line, no link, no email. Two forms:
  - When the configured model is known: `Written by <Family Version> through Jarvis.`
    (e.g. `Written by Claude Opus 4.7 through Jarvis.`)
  - When the configured model is not set (agent uses its own default):
    `Written by <agent CLI name> (default model) through Jarvis.`
    (e.g. `Written by claude (default model) through Jarvis.`)
- **Mapping is local and explicit.** Each agent (`ClaudeAgent`,
  `CodexAgent`, `CursorAgent`, `OpencodeAgent`) gains a method that
  returns the human-readable label for its configured `#model` string.
  A small per-agent table maps known model IDs to their family+version
  label; unknown IDs fall back to the raw model string. We considered
  centralizing the mapping in one module and rejected it: each agent
  already owns the relationship between its CLI and the model strings
  that CLI accepts, and the mapping table will drift as new models
  land.
- **Injection point: the harness, not the prompt.** The footer is
  appended to the agent's PR body by `ensureDraftPr` (or its caller in
  `src/modes/patch/run.ts`) — never asked of the agent. Asking the
  agent to self-attribute invites omission, mangling, or hallucinated
  versions. The agent writes the body; Jarvis stamps the footer.
- **Single chokepoint:** `ensureDraftPr` takes a new
  `attribution: string` opt and appends it to the generated body with
  a blank-line separator. Callers compute the string. This keeps the
  mapping out of `src/pr.ts` and avoids coupling it to agent internals.
- **What if `attribution` is empty/missing?** Then no footer is
  appended. The field is required at the type level but tolerant of
  empty string, so other modes (or future callers) that don't have a
  meaningful agent identity simply pass `""`.
- **Existing PRs are not touched.** `ensureDraftPr` short-circuits when
  a PR already exists; the attribution applies only when Jarvis creates
  the draft. No retroactive editing.
- **Scope cuts:**
  - No tracking of which subagent / which sub-model inside a single
    Jarvis run. Today each patch iteration runs one agent with one
    configured model; multi-model orchestration is not a concern yet.
  - No commit trailers. PR-level only.
  - No configurable attribution string. The format is fixed.
  - No env-var or config flag to disable attribution. If it becomes
    annoying it can be made optional later.

## Subspecs

- [ ] [00 - Agent model labels and PR body footer](./00-agent-attribution-footer.md)
