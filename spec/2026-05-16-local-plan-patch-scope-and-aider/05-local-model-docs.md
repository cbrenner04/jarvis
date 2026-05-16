# 05 - Local model docs

After scoped patch mode and plan-mode aider wiring land, Jarvis needs concise
user documentation for local model usage. The docs should explain when to choose
aider vs opencode for **`jarvis plan`** vs **`jarvis run`**, merge-first semantics,
how to configure **`modes.plan.agentOrder`** and **`modes.patch.agentOrder`**
independently (including Ollama-backed `aider`), and why **`## Patch scope`**
matters for patch iterations while plan iterations rely on harness boundaries
under `spec/<name>/`.

## Decisions

- Keep this doc practical, not a benchmark claim. Jarvis should not assert
  one tool is universally better.
- Describe the staged workflow: **`jarvis plan`** authors the spec (`modes.plan`,
  interview/draft/review phases per [plan-mode.md](../../docs/plan-mode.md)); after the PR merges,
  **`jarvis run`** consumes it (`modes.patch`). Operators may choose **`aider`**
  for either mode independently — never imply one agent order configures both.
- Position **aider** as the practical default **first try** for **local**
  **`modes.patch`** runs when each subspec carries **`## Patch scope`**, and as an
  optional choice for **`modes.plan`** when operators want plan authored locally;
  caveats belong beside limitations (model capability, interview tooling).
- Plan mode with weaker local models needs honest caveats (interview tooling,
  richer prompts). Mention **opencode** in **`modes.plan.agentOrder`** pointing at a
  local-compatible provider/model as one alternative mix alongside **`aider`**.
- Position opencode as the existing general agent option when users prefer
  its provider/tooling flow or have a model that handles tool calls well,
  **including** optionally in plan mode alongside patch mode.
- Document that local Ollama context settings matter and may need tuning
  outside Jarvis.
- Include minimal config snippets illustrating **both** modes when helpful
  (plan order vs patch order), not only `modes.patch` with aider and an Ollama
  model string.

## Patch scope

### Editable

- README.md
- docs/agents.md
- docs/config.md
- docs/plan-mode.md
- docs/run-loop.md
- docs/spec-guidance.md

### Read-only context

- spec/2026-05-16-local-plan-patch-scope-and-aider/index.md
- src/config.ts
- src/agents/aider.ts
- src/agents/opencode.ts

### Out of scope

- Do not add benchmark tables.
- Do not imply **`aider`** is on default **`modes.plan`** / **`modes.patch`** lists.

## Task checklist

- Add short local-model guidance that covers **plan authoring vs patch
  implementation**, merge-first semantics, and which `modes.<mode>` key each
  command reads.
- Add or extend a **`jarvis plan` + local models** subsection in
  [`docs/plan-mode.md`](../../docs/plan-mode.md): link out to broader local-model docs,
  recap merge-first (`docs/spec-guidance.md`), explain **`aider`** may appear in
  **`modes.plan.agentOrder`** with harness-managed scope under `spec/<name>/`,
  and summarize reasonable hybrid patterns (`aider` plan + `aider` patch vs mixing
  cloud plan + local patch).
- Include examples contrasting **`modes.plan`** vs **`modes.patch`** orders,
  including **`aider`** + Ollama model strings where relevant.
- Include an **`aider`** patch-mode example using an Ollama-style model string under
  `modes.patch.agentOrder`.
- Explain that `## Patch scope` improves reliability and is required for
  aider patch runs.
- Explain recovery when the outside-scope guard blocks a run.
- Cross-link existing opencode setup docs rather than duplicating all
  opencode provider setup.

## Acceptance criteria

- [ ] Docs explain when to try **`aider`** versus **`opencode`** for **patch**
      (`jarvis run`) local runs versus **plan** (`jarvis plan`) local runs.
- [ ] Docs describe how **`jarvis plan`** fits a local-heavy setup: authoring and
      iterating on specs via **`modes.plan.agentOrder`** (merge the plan PR), then
      implementing with **`jarvis run`** and **`modes.patch.agentOrder`**; docs cover
      opting **`aider`** into **`modes.plan`** vs **`modes.patch`** independently.
- [ ] Docs show a patch-mode config example for aider with an Ollama model
      string under `modes.patch.agentOrder`.
- [ ] Docs show or clearly link to a **`modes.plan`** example using **`aider`**
      with an Ollama-style model string (may live beside patch samples).
- [ ] Docs explain that aider requires `## Patch scope` with at least one
      editable file.
- [ ] Docs mention local context-window configuration as an Ollama-side
      prerequisite, not something Jarvis controls directly.
- [ ] README links to the local-model guidance.
- [ ] Documentation avoids benchmark or quality claims that are not tested in
      this repo.

## Verification

- Run `bun run typecheck`.
- Run `bun test`.

## Documentation updates

- This subspec is documentation-only.
