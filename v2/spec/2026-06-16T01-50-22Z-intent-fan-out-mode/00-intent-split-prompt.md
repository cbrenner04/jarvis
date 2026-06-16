# Intent-split prompt and sizing rule

## Problem

The fan-out flow needs a prompt that splits one seed into N behavior-level
intents, plus a documented home for the reviewability number it reasons about.
This subspec adds the splitter prompt and the sizing rule it references. The
command that invokes the prompt lands in 01.

## Decisions

- Splitter is a governed, registered prompt step (registry + governance entry),
  not an inline TS string — rules out an ad-hoc unregistered prompt that skips
  registry validation.
- The ~1000-line figure lives only in `v1/docs/spec-guidance.md`; the splitter
  references the rule and never hardcodes the number — rules out baking the
  figure into the prompt (plan-prompt coherence).
- ~1000 changed lines is a reviewability *warning*, not the split input — rules
  out a hard line-count cap driving the split.
- Split unit is independently observable behavior, preferring vertical slices
  over umbrella bundles — rules out splitting by file/layer or by line budget.
- `Prerequisites` lists prerequisite *behaviors*, not intent names, true
  dependencies only; declared and operator-honored, not enforced — rules out
  listing intent filenames or wiring enforcement now (kept additive for seed 03).
- `Prerequisites` entries are one behavior per bullet line — rules out free-prose
  lists, so seed 03's enforcement only adds a check against a fixed shape and
  stays purely additive. The behavior→intent matching rule is deferred to 03.

## Task checklist

- [ ] Add the splitter prompt asset under `prompts/` with required governance
      frontmatter (`id`, `behavior`, `kind`, `revision`).
- [ ] Register it in `prompts/registry.txt` and document it in
      `v1/docs/prompt-governance.md`.
- [ ] Prompt instructs: split by independently observable behavior, prefer
      vertical slices, emit one terse behavior-level intent per slice, each with
      a `name:` and a `Prerequisites` section (one behavior per bullet line, true
      deps, declared/unenforced).
- [ ] Prompt references the spec-guidance reviewability rule with no literal
      line-count figure.
- [ ] `v1/docs/spec-guidance.md`: add the sizing rule (commit-sized subspec vs.
      behavior-sized intent vs. PR-sized spec), the ~1000-line reviewability
      warning, and `ready-intents/` (output) vs. `wip-intents/` (raw-seed input).

## Acceptance criteria

- [ ] A registered prompt step (present in `prompts/registry.txt` and
      `v1/docs/prompt-governance.md`, passing registry-load validation) instructs
      an N-way split along independently observable behaviors, preferring vertical
      slices over umbrella bundles. (Runtime that the split is actually produced
      is graded in 01.)
- [ ] The splitter prompt references the `v1/docs/spec-guidance.md` reviewability
      rule and contains no hardcoded line-count figure.
- [ ] The splitter prompt requires each emitted intent to carry a `name:` and a
      `Prerequisites` section listing prerequisite behaviors (not intent names),
      one behavior per bullet line, declared and operator-honored, not enforced.
- [ ] `v1/docs/spec-guidance.md` states the sizing rule distinguishing a
      commit-sized subspec, a behavior-sized intent, and a PR-sized spec, and
      gives ~1000 changed lines (incl. tests/docs) as a reviewability warning,
      not a hard cap.
- [ ] `v1/docs/spec-guidance.md` documents `ready-intents/` as the authored-intent
      output dir and `wip-intents/` as the raw-seed input.

## Documentation updates

- `v1/docs/spec-guidance.md`: sizing rule, ~1000-line warning, `ready-intents/`.
- `v1/docs/prompt-governance.md`: register the splitter prompt step.
