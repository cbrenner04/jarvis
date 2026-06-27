# Flip prNarrative default to agent and document the tradeoff

## Problem

`prNarrative` defaults to `template` for both patch and plan. `template` is
deterministic and cheap but produces low-value PR descriptions; `agent`
produces markedly better descriptions on the same changes (intake #521).
Because the default is the silent path most PRs take, the low-value default
under-serves review on every PR that doesn't opt into `agent`, and the
tradeoff is never surfaced for the operator to weigh.

The "default" is not one switch. Two code surfaces resolve `template` today,
and a third matters for delivery:
- `DEFAULT_CONFIG.modes.{patch,plan}.prNarrative` — written into a fresh
  bootstrapped config (`v1/src/config.ts`).
- Omit-fallbacks: `patchPrNarrative`/`planPrNarrative` initialize to
  `"template"` before the optional key is read, so a config that omits the key
  resolves to `template` regardless of `DEFAULT_CONFIG` (`v1/src/config.ts`).
- The operator's **existing on-disk config** already serialized
  `prNarrative: "template"` from a prior bootstrap. Validation reads that
  stored key and never consults `DEFAULT_CONFIG`, so flipping the default alone
  leaves the operator's real PRs on `template` — the exact silent path the
  intent targets.

## Decision

Flip the default to `agent` and make it hold on every surface, then make the
operator migration explicit — the flip's value on real PRs is contingent on it.

- Flip `DEFAULT_CONFIG.modes.{patch,plan}.prNarrative` to `"agent"`.
- Flip both omit-fallbacks (`patchPrNarrative`/`planPrNarrative` initializers)
  to `"agent"` so a key-omitting config also resolves to `agent`.
  - Plausible wrong alternative: leave the omit-fallbacks at `template` and flip
    only `DEFAULT_CONFIG`. Ruled out: a partial/hand-edited config that omits
    the key would still resolve to `template`, making the documented default
    false on a live path.
- Make the operator migration explicit in docs: the single operator's existing
  `~/.jarvis/config.json` carries the literal `prNarrative: "template"` from a
  prior bootstrap; to actually get `agent` they must hand-edit those keys to
  `agent` (or delete them to inherit the new default) or regenerate the config.
  Bootstrap does not rewrite an existing config.
- Call-site `?? "template"` fallbacks are defensive-only (config validation
  always populates the field); leave them, but acknowledge them in the spec so
  the "where is the default" map is complete.
- Override path stays the per-mode keys (`modes.patch.prNarrative` /
  `modes.plan.prNarrative` set to `template`) for deterministic/cheap runs.

Preserve existing `template`-asserting tests by pinning
`prNarrative: "template"` explicitly, not by retargeting assertions to `agent`.
- Plausible wrong alternative: rewrite narrative tests to expect agent output.
  Ruled out: those tests pin template-narrative behavior, which is unchanged —
  only the default flips; making them explicit keeps their coverage intact.

## Task checklist

- [ ] Change `DEFAULT_CONFIG.modes.patch.prNarrative` and
  `DEFAULT_CONFIG.modes.plan.prNarrative` to `"agent"` in `v1/src/config.ts`.
- [ ] Change the `patchPrNarrative` and `planPrNarrative` initializers (the
  omit-fallbacks) from `"template"` to `"agent"` in `v1/src/config.ts`.
- [ ] Update default-config assertions in `v1/test/config.test.ts` and
  `v1/test/config-command.test.ts` to expect `"agent"`; add/keep a case proving
  a config that omits `prNarrative` resolves to `agent`.
- [ ] Sweep `v1/test/run.test.ts` (configs built via fresh-temp-dir bootstrap,
  ~40 sites): wherever a test pins template-narrative behavior — runs to
  draft-PR creation and asserts exact agent-call counts or narrative bodies —
  set `prNarrative: "template"` explicitly so it keeps testing template. This
  is an open-ended sweep, not the two `// With default prNarrative: "template"`
  cases only.
- [ ] Sweep the plan-side suite (`v1/test/modes/plan/*`) the same way: the flip
  changes resolved `prNarrative` there identically; pin `template` wherever a
  test pins template behavior.
- [ ] Update `v1/docs/worktrees-and-commits.md` PR narrative section: state
  `agent` is the default, restate the deterministic-cheap (`template`) vs.
  contextual/token-heavier (`agent`) tradeoff, document the override path + cost
  implication, and note the existing-config migration step.
- [ ] Update `v2/docs/v1-behaviors.md` to record the new default, the surfaces
  it holds on, and the tradeoff.

## Acceptance criteria

- [x] A freshly bootstrapped config (no operator override) has
  `modes.patch.prNarrative` and `modes.plan.prNarrative` equal to `agent`.
- [x] A config that omits `prNarrative` for a mode resolves that mode's
  narrative to `agent` (omit-fallback flipped).
- [x] Setting `modes.patch.prNarrative` or `modes.plan.prNarrative` to
  `template` still selects deterministic template narrative for that mode —
  `v1/test/run.test.ts` template-narrative tests stay green.
- [x] `v1/test/config.test.ts` and `v1/test/config-command.test.ts`
  default-config assertions stay green against the new `agent` default.
- [x] `v1/test/run.test.ts` and `v1/test/modes/plan/*` tests stay green after
  the sweep (template behavior unchanged; the default flip is absorbed by
  per-test `prNarrative: "template"` wherever a test pins template).
- [x] `v1/docs/worktrees-and-commits.md` PR narrative section names `agent` as
  the default, documents the `template`-vs-`agent` tradeoff, the override path +
  cost implication, and the existing-config migration step.
- [x] `v2/docs/v1-behaviors.md` records the `agent` default, the surfaces it
  holds on, and the deterministic-cheap vs. agent-contextual tradeoff.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: PR narrative section — new default,
  tradeoff, override path + cost implication, existing-config migration step.
- `v2/docs/v1-behaviors.md`: record the chosen default, the surfaces it holds
  on, and the tradeoff (required: this changes existing v1 default behavior).
