Verifying the spec draft structure and cross-references against the codebase before issuing the verdict.
## Verdict: required refinements

### 1. Index must route the full intent

`index.md` links only `00` and `01`. Roughly half the intent—`pipeline list`, `pipeline wait`, live-list bound, two guard inversions, and full-family help in `pipeline.test.ts`—lives only in `02-pipeline-list-snapshot-and-wait.md`, which is not indexed. An index-routed run would finish after start work and never ship observation commands or satisfy intent acceptance criteria #3–#6.

**Required outcome:** Every intent acceptance criterion has exactly one routed subspec owner. Add `02` (or equivalent) to `index.md`, or merge observation work into a routed subspec without dropping any criterion.

### 2. Collapse the duplicated start seam (`00` / `01`)

`00-daemon.md` and `01-cli.md` repeat the same problem, prerequisites, decisions, tasks, and docs. `01` adds only a help criterion that does not justify a separate implementable slice. Spec guidance requires atomic, same-seam siblings to be serial—not parallel duplicates on `command-tree.ts`, `pipeline.ts`, `pipeline.test.ts`, and docs.

**Required outcome:** One start subspec owns all start implementation and its acceptance criteria (including start help). Remove `01` or reduce it to a no-op slice with no duplicate work; do not leave two subspecs editing the same seam.

### 3. Align filenames, titles, and cross-references

`00-daemon.md` is CLI-only and explicitly forbids daemon changes; the index label “Daemon” contradicts the module boundary. `02` links to `./00-pipeline-start-and-attach-detach.md`, which does not exist.

**Required outcome:** Start subspec filename, index label, and body title reflect the CLI start surface. All internal links resolve to actual files after reconciliation.

### 4. Natural two-subspec split: start, then list/wait

After collapsing `00`/`01`, the spec should be two serial subspecs linked from the index:

- **Start:** `pipeline start`, pre-admission validation, detach, attached terminal completion, start-related guards and help.
- **List/wait:** `pipeline list`, `pipeline wait`, live-list bound, observation guards, full-family help regression in `pipeline.test.ts`.

Every original task and acceptance outcome from the current draft and `intent.md` must appear exactly once across these replacements.

### 5. Attached start must specify a `pipeline_wait` loop

Daemon `pipeline_wait` returns at **either** terminal or `awaiting-approval`. Attached start must stay blocked through approval gates and exit only on terminal. A single RPC call cannot satisfy both contracts.

**Required outcome:** Start subspec decisions explicitly require re-issuing `pipeline_wait` after each `awaiting-approval` result until `{ kind: "terminal", state }`, with terminal JSON and exit-code contract on that final boundary only—not wording that implies one filtered wait call.

### 6. Pin `pipeline list` stdout shape

Intent names stage fields but not CLI output. `pipeline_list` / `PipelineSnapshot` already define the wire projection (`pipelineId`, `name`, `state`, ordered `stages` with `stageId`, `status`, `workflowInvocationId`).

**Required outcome:** List subspec fixes stdout format (recommended: JSON passthrough mirroring the RPC snapshot). Document empty-store output (`pipelines: []`). State that pipeline enumeration order matches `pipeline_list` / store order and stage order matches durable `position` (including nullable `workflowInvocationId`).

### 7. Consolidate help acceptance and dispatch coverage

Help criteria are split: `01` targets `jarvis help pipeline` without naming `pipeline.test.ts`; `02` targets full-family help in `pipeline.test.ts`. Repo convention requires `v2/src/cli.test.ts` dispatch-coverage for new command-tree paths.

**Required outcome:** One help acceptance criterion (or clearly scoped pair) covering the full `jarvis pipeline` family—`start` operands, `--detach`, list snapshot semantics, wait boundaries—and requiring dispatch-coverage in `cli.test.ts` for new tree paths. Drop duplicate help ACs from a removed or merged `01`.

### 8. Close acceptance gaps on error and admission paths

The task checklist mentions failed `pipeline_start` tests but acceptance criteria do not. `pipeline start` must refuse projects with no `pipeline` key (implement treats absent `pipeline` as optional; start is not).

**Required outcome:** Acceptance criteria for: failed daemon admission (non-zero exit, stderr detail, no pipeline ID on stdout); explicit refusal when `pipeline` is missing from project config before daemon connect; optional but recommended alignment with existing CLI patterns for unregistered project, unreachable daemon, and seed flag misuse (delegated to intent workflow contract).

### 9. Anchor the live-list time bound

CLI spec says “bounded test window” without a number. Daemon live-list test uses **500ms** (`Date.now() - startedAt < 500`).

**Required outcome:** Live-list acceptance criterion cites the same bound (or explicitly references the daemon live-list test bound) so CLI and daemon tests do not drift.

### 10. Complete guard-inversion coverage across routed subspecs

Intent requires four invertible guards: pre-admission, detach (no client wait), list non-follow, wait-boundary. Currently two live in routed `00` and two only in orphan `02`.

**Required outcome:** After routing fix, all four inversion criteria are in indexed subspecs, each proving the suppressed effect is absent (invalid config before IPC; detach performs no `pipeline_wait`; list does not follow live transitions; wait does not resolve on `pending`/`running` alone).

### 11. Start subspec prerequisites for attached mode

Attached start depends on `pipeline_wait` and daemon observation behavior. `00` prerequisites cite only `pipeline_start`.

**Required outcome:** If start subspec retains attached-through-approval acceptance criteria, its prerequisites cite completed daemon observation/wait behavior (`pipeline_wait` boundaries, prompt return at existing boundary). Serial index order remains start then list/wait; start may call observation RPCs before list/wait CLI commands exist.

### 12. SIGINT / abort during attached start and `pipeline wait`

Daemon defines `PipelineWaitAbortedError` and abort-without-boundary for `pipeline_wait`. CLI contract for attach and standalone wait is unstated.

**Required outcome:** Decisions or acceptance criteria state that operator abort during attached start or `pipeline wait` follows existing `run wait` / workflow attach patterns (stderr, exit code, no boundary JSON on abort)—not silent success or ambiguous exit `0`.

### 13. Minor pins (low risk, reduce implementer guesswork)

- **Formatter reuse:** One decision line on mechanism—extract `formatProjectPipelineResolutionError` to a shared module or duplicate the `<code>: …` shape locally.
- **Immediate boundary on wait:** When pipeline is already at a boundary, `pipeline wait` returns promptly with correct JSON and exit code (daemon already tests this; CLI should inherit).
- **Meta suite ACs** (`typecheck`, `test:v2`, `test:integration:v2`): redundant atop named behavioral regressions; optional trim, not blocking.

---

**Rationale summary:** Intent treats start, list, and wait as one operator-facing family with six behavioral acceptance criteria and four guard inversions. Spec guidance requires index routing, atomic subspecs on distinct module boundaries, failing-test ACs for runtime behavior, and guard inversion negatives. The draft’s product decisions in `intent.md` and `02` align with intent and existing daemon contracts; the defects are structural routing, duplicate start slices, broken links, and unpinned CLI output/loop semantics that would cause an implement run to under-deliver or ship inconsistent operator behavior.