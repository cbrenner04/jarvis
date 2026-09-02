---
name: boundary-split-emits-near-duplicate-subspecs
---

# Module-boundary splitting emits near-duplicate subspecs and orphan files

## Problem

When a plan draft spans more than one module-boundary surface, `normalizePlanDraftSpecDir` splits it into one subspec per surface. The split copies the parent's framing sections into each child, so when the draft's `## Problem` and `## Surface` describe the *whole* change rather than a per-surface slice, the resulting subspecs are byte-identical apart from their titles — which become bare surface names (`# CLI`, `# Execution loop`), themselves a planning-label smell the repo forbids in authored artifacts.

The split can also leave a subspec on disk that `index.md` does not link, which the orphan-file contract then rejects — so the draft fails the gate for a second, downstream reason.

## Evidence

- **2026-09-02, `exclude-test-support-from-production-glob`** (plan run `b17711b8`): blocked `contract_miss` on `Plan index does not link 02-guard-production-test-support-imports.md`. Inspecting the staged tree showed the deeper defect: `00-cli.md` and `01-execution-loop.md` carry **identical** `## Problem` and `## Surface` text, and the orphan `02` declares a prerequisite on `./00-unify-v2-production-file-predicate.md` — a filename that does not exist in the tree. Not hand-landable; discarded.
- **Prior occurrence, `canonical-pipeline-execution-state-and-stage-claims`**: recorded in `structural-recovery-brief.md` as "plan drafted 2026-08-30 but 00/01 subspecs near-duplicate; needs re-plan". Deferred at the time rather than diagnosed.

Two independent drafts, same shape: the split produces subspecs that are not independently implementable, which is the property the split exists to create.

## Decisions

- A surface split must give each child a per-surface `## Problem` and `## Surface`; copying the parent's whole-change framing verbatim into every child is the defect. Either derive per-surface framing, or refuse the split and report that the draft needs per-surface problems authored.
- Split children must be titled by the behavior they own, not by the surface name (`# CLI` / `# Execution loop` are planning labels, forbidden by `AGENTS.md` in authored artifacts).
- Every file the split writes must be linked from `index.md` in the same operation — an orphan produced *by the splitter* should never reach the orphan-file contract check.
- Cross-references the split rewrites (a child's `## Prerequisites` pointing at a sibling) must resolve to filenames that exist in the emitted tree.

## Acceptance criteria

- [ ] A multi-surface draft whose `## Problem` is whole-change framing does not produce two children with identical `## Problem` text — pinned by a test asserting the children differ or the split refuses with a named reason.
- [ ] Every subspec file the splitter writes is linked from the emitted `index.md` — pinned by a test that splits a three-surface draft and asserts the link set equals the file set.
- [ ] A split child's `## Prerequisites` reference to a sibling resolves to a file present in the emitted tree — pinned by a test.
- [ ] `bun run typecheck` and the `test:shared` pair pass.

## Documentation updates

- `v2/docs/spec-guidance-agent-core.md` — state that a multi-surface draft needs per-surface problem statements, since the split cannot synthesize them.
