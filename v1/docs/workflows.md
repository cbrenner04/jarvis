# Workflows: intent, plan, and patch

Visual reference for how `jarvis1 intent`, `jarvis1 plan`, and `jarvis1 run` (patch mode) execute. Each diagram distinguishes deterministic harness steps from LLM-driven agent calls, and shows where the harness loops vs. takes distinct paths.

The three modes chain: `jarvis1 intent` fans one seed out into authored ready-intents, `jarvis1 plan` drafts a spec tree from one ready-intent, and `jarvis1 run` implements that spec. Each stage opens its own PR for a human to review and merge before the next stage runs.

Authoritative behavior lives in [intent-mode.md](./intent-mode.md), [plan-mode.md](./plan-mode.md), and [run-loop.md](./run-loop.md); this document only summarises control flow.

`jarvis1 review-feedback <worktree-name>` runs one patch-mode agent pass against actionable open PR feedback (unresolved inline review threads plus top-level review-round comments). The target patch worktree must start clean; on success the harness creates one commit (`address PR review comments`) and pushes it. v1 does not auto-resolve threads, post replies, or edit PR metadata.

## Legend

```mermaid
flowchart LR
  det["Deterministic harness step"]:::det
  llm(["LLM agent invocation"]):::llm
  dec{"Decision"}:::dec
  stop["Terminal state"]:::stop
  det --> llm --> dec --> stop

  classDef det fill:#dff5e1,stroke:#2f7d3a,color:#0b3d16;
  classDef llm fill:#e7e0ff,stroke:#5b3fc0,color:#1f1147;
  classDef dec fill:#fff4cf,stroke:#a07b00,color:#3d2c00;
  classDef stop fill:#fde0e0,stroke:#9c2a2a,color:#3d0d0d;
```

- **Green rectangles** are deterministic: pure code in the harness (git ops,
  validation, PR rewrites, telemetry). Re-running the same step with the same
  inputs produces the same result.
- **Purple stadiums** are LLM-driven: one agent CLI invocation. Output is
  non-deterministic; the harness only constrains it through prompt rules,
  post-hoc validation, and the write boundary.
- **Yellow diamonds** are deterministic branch points whose direction depends
  on LLM output (e.g. "did the agent append `## Blocker`?"). The check is
  deterministic; the input that drives it is not.
- **Red rectangles** are terminal exits.

## Overview: where intent, plan, and patch meet

```mermaid
flowchart TD
  start([User has an idea]):::neutral
  start --> intentQ{"Ready-intent exists?"}:::dec
  intentQ -- no --> intentEntry
  intentQ -- "yes (skip ahead)" --> planQ
  planQ{"Spec tree exists?"}:::dec
  planQ -- no --> planEntry
  planQ -- yes --> runEntry

  subgraph intentMode["jarvis1 intent — fan out a seed (branch: intent/&lt;name&gt;)"]
    direction TB
    intentEntry["Preflight + worktree"]:::det
    intentEntry --> split(["Split seed into N<br/>behavior-level intents"]):::llm
    split --> writeIntents["Validate + write N files to<br/>&lt;targetDir&gt;/ready-intents/ · commit · ready PR"]:::det
  end

  writeIntents --> intentHandoff["Human reviews the split,<br/>picks one ready-intent"]:::det
  intentHandoff --> planEntry

  subgraph planMode["jarvis1 plan — author a spec (branch: plan/&lt;name&gt;)"]
    direction TB
    planEntry["Validate ready-intent + worktree<br/>(copy intent.md)"]:::det
    planEntry --> draft(["Draft: prereq gate →<br/>index.md + subspecs (one call)"]):::llm
    draft --> openDraft["Open draft PR"]:::det
    openDraft --> review(["Self-review: adversary → advocate →<br/>adjudicator → actuator<br/>(one flow per pass) × --review-passes (default 1)"]):::llm
    review --> markReady["bun run fix (commit if dirty) →<br/>bun run ready (strict verify) →<br/>gh pr ready (auto)"]:::det
  end

  markReady --> handoff["Human reviews + merges plan PR to main"]:::det
  handoff --> runEntry

  subgraph patchMode["jarvis1 run — implement the spec (branch: auto)"]
    direction TB
    runEntry["Preflight + per-spec worktree"]:::det
    runEntry --> iterLoop{"Unchecked tasks remain?"}:::dec
    iterLoop -- yes --> agentCall(["Agent edits files,<br/>ticks acceptance criteria"]):::llm
    agentCall --> commit["Commit subspec progress · push<br/>ensure / update draft PR"]:::det
    commit --> iterLoop
    iterLoop -- no --> ready["Completion-transition ready gate"]:::det
    ready --> shrink(["Shrink: simplify the<br/>implementation diff (one call)"]):::llm
    shrink --> patchReview(["Review: adversary → advocate →<br/>adjudicator → actuator<br/>(one flow per pass) × review passes (default 1)"]):::llm
    patchReview --> patchReady["Final gate + gh pr ready"]:::det
  end

  patchReady --> done["Human reviews + merges patch PR"]:::stop

  classDef det fill:#dff5e1,stroke:#2f7d3a,color:#0b3d16;
  classDef llm fill:#e7e0ff,stroke:#5b3fc0,color:#1f1147;
  classDef dec fill:#fff4cf,stroke:#a07b00,color:#3d2c00;
  classDef stop fill:#fde0e0,stroke:#9c2a2a,color:#3d0d0d;
  classDef neutral fill:#eef1f5,stroke:#4a5566,color:#1a1f29;
```

Intent is a **single split call** that sizes work before planning. Plan is a **fixed pipeline**: draft → review, with the review iteration count set up front by `--review-passes`. Patch is a **single implementation loop** that terminates when the spec's checklist is empty, followed by optional post-completion shrink and review phases. All three modes produce a PR that a human reviews and merges. Intent never drafts spec directories; plan never writes outside its spec tree; patch is free to edit anywhere in its worktree. Blocker exits, quota fallback, the prerequisite gate, and the full set of patch exit codes are deferred to the detailed diagrams below.

## Intent mode

`jarvis1 intent` is a **single agent call** that sizes work before planning: one seed (inline text or a `seeds/<seed>.md` file) fans out into N behavior-level ready-intents, each of which later drafts into one spec / one PR. It does not refine, draft spec directories, or write `index.md`.

```mermaid
flowchart TD
  start([jarvis1 intent ...]):::neutral

  start --> pf["Preflight: resolve repo,<br/>worktree + branch intent/&lt;name&gt;"]:::det
  pf --> seed["Resolve seed<br/>(inline text or seeds/&lt;seed&gt;.md)"]:::det
  seed --> splitCall(["Agent: split seed into N<br/>behavior-level intents"]):::llm
  splitCall --> stage["Stage + validate output<br/>(frontmatter name:, ## Prerequisites)"]:::det
  stage --> valid{"Valid + no name collision?"}:::dec
  valid -- no --> abort["Abort: no ready-intents written,<br/>no PR · exit non-zero"]:::stop
  valid -- yes --> writeFiles["Write N files to<br/>&lt;targetDir&gt;/ready-intents/ · commit · push"]:::det
  writeFiles --> pr["Open PR and flip ready<br/>for split review"]:::det
  pr --> done["exit 0 · operator picks one ready-intent"]:::stop

  classDef det fill:#dff5e1,stroke:#2f7d3a,color:#0b3d16;
  classDef llm fill:#e7e0ff,stroke:#5b3fc0,color:#1f1147;
  classDef dec fill:#fff4cf,stroke:#a07b00,color:#3d2c00;
  classDef stop fill:#fde0e0,stroke:#9c2a2a,color:#3d0d0d;
  classDef neutral fill:#eef1f5,stroke:#4a5566,color:#1a1f29;
```

Splitter output is staged and validated **before** anything lands in `ready-intents/`; invalid output or a `name:` collision aborts the run without partial writes and without a PR. Intent mode reuses the same repo resolution, plan agent order, and quota fallback as plan mode. The operator reviews the split on the intent PR, then runs `jarvis1 plan` on one emitted ready-intent at a time.

## Plan mode

`jarvis1 plan` **consumes a ready-intent** (`<targetDir>/ready-intents/<name>.md`) and is **phase-structured**: it starts at the **draft** phase (intent authoring/refinement now lives in intent mode), then runs a fixed number of **review** passes set up front by `--review-passes`. The agent does not decide when to stop.

```mermaid
flowchart TD
  start([jarvis1 plan &lt;targetDir&gt;/ready-intents/&lt;name&gt;.md]):::neutral

  start --> validate["Validate ready-intent (before any branch):<br/>lives in ready-intents/, name: matches file,<br/>## Prerequisites present"]:::det
  validate --> validQ{"Valid ready-intent?"}:::dec
  validQ -- no --> rejectExit["exit non-zero: author a ready-intent<br/>with jarvis1 intent first"]:::stop
  validQ -- yes --> setup["Resolve name (collision-suffix),<br/>worktree .worktree/plan-&lt;name&gt;/ + branch plan/&lt;name&gt;,<br/>copy ready-intent bytes → spec/&lt;dir&gt;/intent.md"]:::det

  setup --> draftCall(["Agent: prerequisite gate, then<br/>draft index.md + subspecs"]):::llm
  draftCall --> draftBoundary["Boundary check:<br/>revert writes outside spec/&lt;dir&gt;/"]:::det
  draftBoundary --> draftBlk{"Prereq unmet / blocker /<br/>boundary violation?"}:::dec
  draftBlk -- "prereq unmet or blocker" --> commitDraftThenBlk["Commit plan: draft (if any) · push<br/>then plan: blocker · push"]:::det --> exitBlk["exit 1"]:::stop
  draftBlk -- "boundary violation" --> commitBlk["Commit plan: blocker · push"]:::det --> exitBlk
  draftBlk -- no --> draftVal["Validate: index.md present,<br/>subspecs have ## Acceptance criteria"]:::det
  draftVal --> commitDraft["Commit plan: draft · push"]:::det
  commitDraft --> openPR["gh pr create --draft<br/>(title: plan: &lt;name&gt;)"]:::det

  openPR --> reviewLoop{"Review pass k ≤ --review-passes?"}:::dec
  reviewLoop -- yes --> adversary(["Agent: adversary critiques"]):::llm
  adversary --> advocate(["Agent: advocate defends"]):::llm
  advocate --> adjudicator(["Agent: adjudicator writes verdict"]):::llm
  adjudicator --> verdictQ{"Verdict non-empty?"}:::dec
  verdictQ -- yes --> actuator(["Agent: actuator applies verdict<br/>to spec files"]):::llm
  verdictQ -- no --> reviewCommit
  actuator --> reviewBoundary["Boundary check + validate<br/>(reviewers read-only; revert spec/code edits)"]:::det
  reviewBoundary --> reviewBlk{"Blocker?"}:::dec
  reviewBlk -- yes --> commitRevBlk["Commit plan: review k · push<br/>then plan: blocker · push"]:::det --> exitBlk
  reviewBlk -- no --> reviewCommit["Commit plan: review: &lt;role&gt; / actuator · push<br/>updatePrBody (det)"]:::det
  reviewCommit --> reviewLoop

  reviewLoop -- no --> ready["bun run fix (commit if dirty) →<br/>bun run ready (strict verify) →<br/>gh pr ready (auto)"]:::det
  ready --> done["exit 0 · print Next steps"]:::stop

  classDef det fill:#dff5e1,stroke:#2f7d3a,color:#0b3d16;
  classDef llm fill:#e7e0ff,stroke:#5b3fc0,color:#1f1147;
  classDef dec fill:#fff4cf,stroke:#a07b00,color:#3d2c00;
  classDef stop fill:#fde0e0,stroke:#9c2a2a,color:#3d0d0d;
  classDef neutral fill:#eef1f5,stroke:#4a5566,color:#1a1f29;
```

What loops vs. what's a distinct path:

- **Loop** (count fixed before the run): review passes (`--review-passes`,
  default 1). Each pass is **one flow** through a three-role debate (**adversary
  → advocate → adjudicator**) followed by an **actuator** call that applies the
  adjudicator's verdict to the spec files. An empty verdict skips the actuator.
- **Distinct phases** (run at most once per invocation): validate ready-intent →
  setup → draft → review-loop → mark-ready. There is **no** refine phase and
  **no** temporary-worktree rename; the worktree/branch are created under the
  final name directly.
- **Prerequisite gate**: before drafting, the draft agent judges whether each
  behavior in the ready-intent's `## Prerequisites` section is legibly present
  in the repo. If any is unconfirmed, it appends a `## Blocker` to `intent.md`,
  writes no spec files, and plan exits non-zero. An empty / bareword-`none`
  prerequisites body skips the gate.
- **Quota fallback** is an *orthogonal* loop not shown above: on every agent
  call, if the chosen agent reports a quota signal, the harness rotates to the
  next agent in that phase's chain (`modes.plan.agentOrder` for draft; review
  uses `modes.review.agentOrder` → `modes.plan.agentOrder`). During draft a
  generic agent error *also* rotates; `model_config` rotates on draft and
  intent-split only. Review matches patch review (quota rotates, `model_config`
  exits 3, other hard errors stop the pass).
- **Determinism**: every green box is reproducible from the same git state.
  Every purple box reads files + emits files; jarvis enforces invariants
  *after* the call (write boundary, append-only on `intent.md`, validation
  rules) but cannot make the agent's text choice deterministic.
- **Readiness transition**: when every phase succeeds without a blocker,
  `jarvis1 plan` runs built-in `bun run fix` (committing any dirty output first),
  then built-in `bun run ready`, and on green calls `gh pr ready`.
  The authoritative built-in ready/fix split, gate ordering, and step order live
  in [`v2/docs/v1-behaviors.md`](../../v2/docs/v1-behaviors.md). This committed
  plan-mode call site is not wired to `readyCommand`; it runs the built-ins. If
  any gate step fails, the PR stays in draft.

`--resume` re-enters the diagram at the review-loop, reusing the existing worktree, branch, and PR. With `modes.plan.commit: false` there is no branch/worktree/PR: specs are written under `~/.jarvis/specs/...` and no commit or readiness transition runs.

## Patch mode (`jarvis1 run`)

Patch mode is **iteration-structured**: a single loop that terminates when the spec has no unchecked checkboxes (or when an exit condition fires). The agent chooses what work to do each iteration; the harness picks the spec, picks the task, commits, and decides whether progress was made.

```mermaid
flowchart TD
  start([jarvis1 run spec/.../index.md]):::neutral

  start --> pf["Preflight: resolve repo,<br/>ensureWorktree, acquire lock,<br/>assertGhReady"]:::det
  pf --> warn["Maybe warn:<br/>unmerged plan/&lt;name&gt; on origin"]:::det
  warn --> top{"countUnchecked(spec) == 0?"}:::dec

  top -- yes --> finish["Clean tree?"]:::det
  finish --> cleanQ{"git status clean?"}:::dec
  cleanQ -- no --> dirty["exit 6: dirty worktree<br/>(point at jarvis1 triage)"]:::stop
  cleanQ -- yes --> gitQ{"git enabled?"}:::dec
  gitQ -- no --> ok["print spec complete + PR URL<br/>exit 0"]:::stop
  gitQ -- yes --> compGate["Completion-transition ready gate<br/>runReadyAndCommit · record green HEAD"]:::det
  compGate --> implQ{"≥1 implementation iteration?"}:::dec
  implQ -- no --> markReady["maybeMarkReady (reuse recorded green<br/>if tree unchanged) → gh pr ready"]:::det
  markReady --> ok
  implQ -- yes --> shrinkGate["Pre-shrink gate (reuse recorded green<br/>if tree unchanged)"]:::det
  shrinkGate --> shrinkCall(["Shrink agent: simplify implementation diff"]):::llm
  shrinkCall --> shrinkContract["Revert out-of-scope + spec edits;<br/>contract check: tests pass, no AC regression,<br/>no deleted in-scope test"]:::det
  shrinkContract --> shrinkPass{"Contract met + changes?"}:::dec
  shrinkPass -- no --> shrinkDiscard["discard shrink changes"]:::det --> reviewQ
  shrinkPass -- yes --> commitShrink["commit shrink: simplify · push"]:::det --> reviewQ
  reviewQ{"Review passes &gt; 0?"}:::dec
  reviewQ -- no --> markReady
  reviewQ -- yes --> baselineReady["Review baseline gate<br/>(reuse recorded green if tree unchanged)"]:::det
  baselineReady --> reviewLoop{"Review pass k ≤ passes?"}:::dec
  reviewLoop -- yes --> debate(["adversary → advocate → adjudicator<br/>(modes.review.agentOrder→plan)"]):::llm
  debate --> verdictQ{"Verdict non-empty?"}:::dec
  verdictQ -- yes --> actuator(["actuator: apply verdict to code"]):::llm
  actuator --> reviewRevert
  verdictQ -- no --> reviewRevert["revert spec-tree edits"]:::det
  reviewRevert --> reviewBlk{".jarvis-review-blocker written?"}:::dec
  reviewBlk -- yes --> commitReviewBlk["commit pass · post PR comment"]:::det --> blkExit["exit 7: blocker"]:::stop
  reviewBlk -- no --> commitReview["commit review pass (if non-empty) · push"]:::det --> reviewLoop
  reviewLoop -- no --> finalReady["Final gate: bun run fix (commit if dirty) →<br/>bun run ready → gh pr ready"]:::det
  finalReady --> ok

  top -- no --> agentQ{"Any agent left in agentOrder?"}:::dec
  agentQ -- no --> quotaExit["exit 2: all agents quota-exhausted"]:::stop
  agentQ -- yes --> pickTask["Pick first unchecked task<br/>resolve active subspec"]:::det
  pickTask --> blkPre{"Subspec already has ## Blocker?"}:::dec
  blkPre -- yes --> blkExit["exit 7: blocker"]:::stop
  blkPre -- no --> snap["Snapshot acceptance criteria<br/>build prompt (det, rules.md inlined)"]:::det
  snap --> iterCall(["Agent: edit files, tick checkboxes"]):::llm

  iterCall --> kind{"result.kind?"}:::dec
  kind -- quota --> rotate["Drop agent from order<br/>telemetry: quota-fallback"]:::det --> top
  kind -- model_config --> mcExit["exit 3: model-config"]:::stop
  kind -- error --> lenient{"Lenient quota fallback applies?"}:::dec
  lenient -- yes --> rotate
  lenient -- no --> idleQ{"aborted: idle-timeout?"}:::dec
  idleQ -- yes --> idleAgentQ{"Later agentOrder rung?"}:::dec
  idleAgentQ -- yes --> idleRotate["Drop agent · telemetry: watchdog-idle-timeout-fallback"]:::det --> top
  idleAgentQ -- no --> idleExit["exit 8: watchdog-idle-timeout"]:::stop
  idleQ -- no --> errExit["exit 3: agent-error"]:::stop

  kind -- ok --> diff["Diff acceptance criteria<br/>before / after"]:::det
  diff --> blkPost{"Blocker added this iteration?"}:::dec
  blkPost -- yes --> commitWipBlk["commitWipProgressWithBlocker · push"]:::det --> blkExit
  blkPost -- no --> allQ{"All criteria checked?"}:::dec

  allQ -- yes --> commitSub["commitSubspec · push<br/>ensureDraftPr (once) / updatePrBody<br/>maybeMarkReady"]:::det --> top
  allQ -- no --> progQ{"newlyChecked.length &gt; 0?"}:::dec
  progQ -- yes --> commitWip["commitWipProgress · push"]:::det --> top
  progQ -- no --> editedQ{"Files edited but nothing ticked?"}:::dec
  editedQ -- yes --> dirtyMid["exit 6: dirty worktree mid-run"]:::stop
  editedQ -- no --> noProg{"countUnchecked unchanged?"}:::dec
  noProg -- yes --> noProgAgentQ{"Later agentOrder rung?"}:::dec
  noProgAgentQ -- yes --> noProgRotate["Drop agent · telemetry: no-progress-fallback"]:::det --> top
  noProgAgentQ -- no --> noprogExit["exit 4: no-progress"]:::stop
  noProg -- no --> top

  top -.->|maxIterations reached| maxExit["exit 5: max-iterations"]:::stop
  top -.->|iteration/run wall-clock timeout| toExit["exit 8: timeout (terminal)"]:::stop
  top -.->|SIGINT| sigExit["exit 130"]:::stop

  classDef det fill:#dff5e1,stroke:#2f7d3a,color:#0b3d16;
  classDef llm fill:#e7e0ff,stroke:#5b3fc0,color:#1f1147;
  classDef dec fill:#fff4cf,stroke:#a07b00,color:#3d2c00;
  classDef stop fill:#fde0e0,stroke:#9c2a2a,color:#3d0d0d;
  classDef neutral fill:#eef1f5,stroke:#4a5566,color:#1a1f29;
```

What loops vs. what's a distinct path:

- **Implementation loop**: the top-level iteration. Each iteration is one agent
  call followed by deterministic bookkeeping. Exits when the spec has no
  unchecked boxes.
- **Completion-transition ready gate**: reached at most once per run, when a
  `git: true` run first observes zero unchecked boxes. On `full` it runs
  `bun run fix` → commit-if-dirty (and push) → strict verification →
  post-verification commit-if-dirty (and push) when applicable, and on a clean
  green records the result keyed to post-post-verification-commit HEAD + clean
  worktree (residual still-dirty porcelain after post-verification commit
  aborts at exit 6). The post-completion phases (shrink, review,
  `maybeMarkReady`) **reuse** that recorded green result and skip re-running
  verification whenever the tree is unchanged since the recording. See
  [run-loop.md](./run-loop.md#completion-transition-ready-gate).
- **Shrink phase** (post-completion): a single shrink agent call that tries to
  simplify the implementation diff. Runs only when ≥1 implementation iteration
  completed and git is enabled. Out-of-scope and spec-tree edits are reverted;
  the result is discarded unless tests pass with no acceptance-criteria
  regression and no deleted in-scope test. A surviving change becomes one
  `shrink:` commit. Order is **shrink → review → `maybeMarkReady`**.
- **Review phase** (post-completion): optional debate loop controlled by
  `modes.review.passes` (default 1). Skipped if passes is 0, git is false, or no
  implementation iteration ran. Each pass is **one flow** through a read-only
  **adversary → advocate → adjudicator** debate; a non-empty adjudicator verdict
  then drives an **actuator** call that applies it to the code. Ends with a final
  `full` gate (`bun run fix` → commit-if-dirty → `bun run ready` →
  post-verification commit-if-dirty when applicable) + `gh pr ready`.
  Blockers (`.jarvis-review-blocker`) exit 7 immediately.
- **Distinct exit paths**: In the implementation loop, `kind ∈ {ok, quota,
  model_config, error}` fan out from a single decision; the same iteration
  cannot take two of them.
- **Agent ladder rotation** (patch implementation): quota, lenient probable-quota,
  no-progress, and idle-timeout each drop the current agent and retry the same
  subspec when a later `agentOrder` rung remains. Generic `error` exits 3.
  Terminal exit `4` or `8` only after the final rung stalls (or `maxIterations`).
- **Determinism**: the agent's edits and the model-authored PR narrative
  (Description + Decisions) are non-deterministic, but the rest of the
  downstream (acceptance-criteria diff, commit-shape selection, the PR-body
  header/footer rewrite, ready-flip on completion) is a pure function of files
  on disk. The narrative is generated once and then preserved inside the
  `jarvis:narrative` markers across rewrites.
- **Readiness gates**: on `full`, the completion-transition gate and the review
  final gate run `bun run fix` → commit-if-dirty (and push) → strict
  verification → post-verification commit-if-dirty (and push) when applicable;
  `readyCommand` overrides the verification command only, and residual
  still-dirty porcelain after post-verification commit aborts at exit 6 rather
  than flipping ready. `fast` baseline gates run neither fix, pre-ready commit,
  post-verification commit, nor post-verification porcelain enforcement. The
  authoritative built-in ready/fix split, gate ordering, and step order live in
  [`v2/docs/v1-behaviors.md`](../../v2/docs/v1-behaviors.md). The baseline
  gates reuse the recorded green result when the tree is unchanged; the final
  gate always verifies before the draft→ready flip. If any step fails, the PR
  stays in draft for manual correction.

Dotted edges show pre-emption — `maxIterations`, timeouts, and SIGINT can fire at the top of any iteration before the agent call.

---

## At-a-glance (pitch view)

For an external audience: same flows, fewer branches.

```mermaid
flowchart LR
  subgraph intent["jarvis1 intent — size the work"]
    direction TB
    in1["Split seed into N<br/>ready-intents"]:::llm
  end

  subgraph plan["jarvis1 plan — author a spec"]
    direction TB
    pl1["Draft spec tree<br/>(prereq gate)"]:::llm
    pl2["Self-review debate (N passes)"]:::llm
    pl1 --> pl2
  end

  subgraph patch["jarvis1 run — implement a spec"]
    direction TB
    pa1["Pick next unchecked task"]:::det
    pa2["Agent edits files, ticks boxes"]:::llm
    pa3["Commit + update PR"]:::det
    pa4["Shrink + review, then ready"]:::llm
    pa1 --> pa2 --> pa3 --> pa1
    pa3 -. spec complete .-> pa4
  end

  intent --> r0["Human reviews split,<br/>picks a ready-intent"]:::det --> plan --> review["Human reviews / merges plan PR"]:::det --> patch --> ship["Human reviews / merges patch PR"]:::stop

  classDef det fill:#dff5e1,stroke:#2f7d3a,color:#0b3d16;
  classDef llm fill:#e7e0ff,stroke:#5b3fc0,color:#1f1147;
  classDef stop fill:#fde0e0,stroke:#9c2a2a,color:#3d0d0d;
```

Intent sizes the work into ready-intents; plan is a fixed pipeline of LLM steps (draft → review debate); patch is a single loop until the spec's checklist is empty, then a post-completion shrink + review. In all three, the LLM produces text and edits; the harness deterministically commits, pushes, updates the PR, and decides when to stop.
