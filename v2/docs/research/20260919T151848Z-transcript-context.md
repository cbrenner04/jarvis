# September transcript context and duration pilot

Companion: [transcript-audit.py](./20260919T151848Z-transcript-audit.py). Uses the frozen September 1–19 cohort from [API cost and efficiency](./20260919T151848Z-september-api-cost.md); no later telemetry is mixed into the comparison. [Review outcomes](./20260919T151848Z-review-effectiveness.md) are reported separately.

## Findings

- Retained Claude transcripts uniquely match **1,119/1,119 invocations**. For **1,060/1,063 priced calls**, deduplicated root token counters exactly reproduce all four telemetry fields. The other three are excluded from context distributions and cost reconciliation.
- Implementation has the largest response-count tail among the roles shown: **31 model responses at the median, 122 at p90**. Its median initial prompt is about 25,000 characters, while average input context per response is about 68,000 tokens. These different units cannot be subtracted; context also contains instructions, tools, history, and tool results.
- At p90, implementation calls carry **264,000 characters of tool results** and **15 repeated same-path Read calls**. These are useful targets for inspection, but repeated reads may cover different ranges or reflect intervening edits.
- The four-call duration pilot is useful for deciding what to instrument. The longest failure contains a **16-hour-46-minute gap between native events** around a test command; two of the three roughly 45-minute Cursor failures have explicit timeout evidence. Recorded duration cannot establish how long the model was working.

## Context measurements

Match native roots using working directory and the first textual user-message timestamp within an invocation's interval, allowing two seconds of start-time tolerance. Resolve overlapping candidates by exact full-session usage, then strict timestamp containment; reject ambiguous files or multiple files assigned to one invocation. This snapshot has neither ambiguity nor collisions. Bound analysis to settlement time, deduplicate assistant messages by message ID, and retain the highest output counter, choosing the latest on ties. Require bounded root totals to match telemetry before using a priced call in the context cohort.

Values below are **median / p90**, using nearest-rank p90. Prompt and result lengths count characters, not tokens. Input context is `(uncached input + cache reads + cache writes) / distinct model responses` per invocation; it counts context processed repeatedly, not unique information. Tool results are deduplicated by tool-use ID. Child transcripts are excluded from these root distributions and valued separately in the cost report.

| Role | Calls | Initial user characters | Model responses | Mean input-context tokens per response | Tool-result characters | Repeated Read paths |
|---|---|---|---|---|---|---|
| Implement | 234 | 25,147 / 29,114 | 31 / 122 | 68,180 / 165,002 | 60,981 / 263,911 | 0 / 15 |
| Actuator | 167 | 22,171 / 34,206 | 15 / 45 | 57,049 / 92,737 | 37,730 / 115,170 | 0 / 5 |
| Plan | 153 | 23,674 / 25,780 | 6 / 11 | 42,062 / 51,495 | 13,940 / 47,889 | 0 / 0 |
| Critic | 39 | 20,555 / 24,333 | 1 / 11 | 48,175 / 62,286 | 0 / 40,115 | 0 / 1 |
| Adversary | 126 | 28,044 / 75,459 | 4 / 9 | 46,741 / 62,630 | 10,278 / 34,565 | 0 / 0 |
| Advocate | 127 | 33,084 / 78,967 | 2 / 3 | 43,028 / 61,738 | 366 / 11,357 | 0 / 0 |
| Adjudicator | 125 | 32,738 / 79,298 | 1 / 2 | 42,453 / 62,090 | 0 / 3,704 | 0 / 0 |

The remaining 89 matched calls have the shrink role; they are included in the script output but omitted here because [shrink already has its own study](./20260831T052355Z-implement-shrink-impact.md). This is a successful, retained Claude cohort, not a comparison across agents or failed calls.

Implementation and actuator loops merit targeted inspection of large tool outputs and repeated reads. Plan and debate calls generally take fewer model responses, although initial review prompts have a substantial upper tail. Controlled experiments should measure total token value and task quality together: shortening a prompt or eliminating a cached read does not by itself establish savings. These distributions do not identify which text is redundant, and Bash-based file reads are absent from the Read-path count.

## Four-call duration pilot

Select the four longest non-ok invocations with role `implement`, across all agents, from the same telemetry window. Correlate with retained native records and available harness logs. This is a tail sample, not a general latency estimate.

| Invocation | Agent / exit | Recorded minutes | Retained evidence |
|---|---|---|---|
| `80f0e6bf-b100-4b81-9614-41d17da9344f` | Claude / stall | 1,018.40 | A 1,006.40-minute event gap begins after a Bash test call; native activity continues after settlement. |
| `0de6c385-7706-4a67-a501-63386dbf912e` | Cursor / error | 45.13 | Harness log ends with `AbortError` and `outcome=timeout`; native chat metadata last updated 36.26 minutes after dispatch. |
| `41a3f9de-d8c4-407f-9fea-d50818ac0245` | Cursor / error | 45.12 | Native chat metadata last updated 44.00 minutes after dispatch; harness session log was not retained. |
| `19cc8f2e-60fe-48bb-a80d-e1218b6d1f09` | Cursor / error | 45.10 | Harness log ends with `AbortError` and `outcome=timeout`; native chat metadata last updated 42.77 minutes after dispatch. |

The Claude invocation ran from `2026-09-18T21:54:35.190Z` to `2026-09-19T14:52:59.486Z`. At `22:06:35.573Z`, its assistant issued `bun run test:v2 > .scratch/t.log 2>&1` with a 600,000 ms tool timeout. The next timestamped user event is at `14:52:59.310Z` the following day. Retained harness output includes 30-second and 60-second test heartbeats. The transcript contains **29 timestamped records after settlement**, continuing through approximately `15:00:07Z`, including further tools and edits. Those later records are excluded from invocation accounting.

The gap does not distinguish machine suspension, a hung test, delayed delivery, or teardown behavior. Cursor metadata likewise does not prove the time of the last model response, and the inspected stores do not provide a reliable per-tool timeline. These limitations prevent a useful model/tool/wait-time breakdown today.

**The pilot supports a targeted follow-up:** capture dispatch, last model event, tool start/end, timeout request, process exit, and settlement timestamps on the same invocation ID; retain exit reason and partial usage. Check whether work continues after settlement. Pair wall-clock timestamps with monotonic elapsed time and machine sleep/wake evidence when diagnosing long gaps. Investigating these four cases is more informative than extrapolating their duration into token cost.

## Reproduction

Python standard library only. Use copied native project directories with layout `<projects>/<encoded-cwd>/<session>.jsonl` and child transcripts under `<session>/subagents/`. Keep raw text private in repo-local scratch. This run retained 1,119 root and 12 child files; 10 children belong to the usage-exact priced cohort. The generated JSON fingerprints all matched roots and those 10 children with SHA-256. Source copies were checked against the earlier native index before analysis.

```sh
python3 v2/docs/research/20260919T151848Z-transcript-audit.py \
  --telemetry .scratch/research-input/telemetry.jsonl \
  --prices .scratch/research-input/prices.json \
  --transcripts .scratch/transcript-study/claude \
  --start 2026-09-01T00:00:00Z \
  --end 2026-09-19T15:18:48.559706+00:00 \
  > .scratch/transcript-study/audit.json
```

The output contains coverage, input fingerprints, role distributions, paired cost reconstruction, review sample IDs/tool counts, and the duration-pilot ranking. It emits no transcript text or tool arguments. Unknown comparison models or incomplete cache-lifetime counters stop cost reconstruction instead of silently receiving a zero price. Rates are fixed study assumptions, including the operator-supplied Sonnet rates, not a live pricing lookup.

Manual review and Cursor timing annotations supplement the script. The retained Cursor stores are `.scratch/transcript-study/cursor/{6adcc340-8145-4cd2-ad1d-1f228ab103d3,06e6db52-e7b4-4da9-9c4d-109169373481,469350dc-4bc5-4d0f-ab21-af98011b67b5}/`, in table order. Correlate chat creation with dispatch and inspect available harness logs by the full run IDs emitted under `duration_pilot`; metadata update times are only supporting evidence. Raw stores and logs are not published in the PR.

Persisted native counters reproduce terminal telemetry in the accepted cohort; this does not establish that streamed assistant output counters are final. Failure-usage capture should use terminal totals or streamed `message_delta` output counters and preserve unavailable fields. [Claude SDK cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking).
