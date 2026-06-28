# v2-architecture role resolution

## Problem

`v2/docs/v2-architecture.md` still describes steps naming model categories,
category→model stores, and the review-debate section explains reviewer/actuator
split via thinking/reviewing/executing classes.

## Decisions

- **Edit in place; no new architecture sections** — rules out a parallel
  category/role dual-write period inside the same file.
- **Layered-model table binds steps to role** — rules out leaving "model
  category" as the step resolution field in the primary architecture table.
- **Review-as-debate cites roles, not classes** — rules out retaining
  "reviewing-class" / "executing-class" / "thinking-class" as the explanation
  for reviewer vs actuator model split.
- **Cross-link `role-resolution.md`** from layered model and per-project config
  — rules out duplicating the full `Role` union in architecture prose.

## Task checklist

- Update the layered-model table: step resolution field is **role**, not model
  category; project config cites role→model store (not category→model).
- Replace category→model resolution prose in per-project config with
  role→model semantics; preserve agent-fallback-order vs model-resolution split.
- Rewrite review-as-debate "why categories matter" to "why roles matter" using
  `adversary`/`advocate`/`adjudicator`/`actuator`/`plan`/`implement`.
- Update config show/edit and config-vs-source validation wording to `(role,
  agent)` pairs.
- Add cross-links to `v2/docs/role-resolution.md`.
- Retire `thinking`/`reviewing`/`executing` as resolution keys throughout the
  file (historical mention only if needed to note retirement).

## Acceptance criteria

- [ ] `v2/docs/v2-architecture.md` layered-model table and step terminology cite
      **role**, not model category, as the step resolution field.
- [ ] Per-project config section documents role→model resolution (agent fallback
      order outer loop; `(agent, role) → model` inner resolution) with no
      category→model store wording.
- [ ] Review-as-debate section explains reviewer vs actuator model split using
      role names, not thinking/reviewing/executing classes.
- [ ] The file cross-links `v2/docs/role-resolution.md`.
- [ ] `rg -i 'thinking|reviewing|executing' v2/docs/v2-architecture.md` finds
      no match used as a model-resolution key.

## Documentation updates

- `v2/docs/v2-architecture.md` — role→model resolution; layered-model table;
  review-as-debate section.
