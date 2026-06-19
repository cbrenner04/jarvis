#\!/bin/bash
# Extract the 5 pre-instrumentation candidates

jq -r 'select(.namespace == "jarvis:2026-06-14T17-21-04Z-daemon-host-ipc-logging" and .ts == "2026-06-14T20:33:43.945Z" and .iteration == 3)' runs.jsonl > /tmp/candidate1.json

jq -r 'select(.namespace == "jarvis:2026-06-14T17-55-24Z-plan-intent-refine-flow" and .ts == "2026-06-14T20:52:32.175Z" and .iteration == 4)' runs.jsonl > /tmp/candidate2.json

jq -r 'select(.namespace == "jarvis:2026-06-14T17-21-04Z-daemon-host-ipc-logging" and .ts == "2026-06-14T21:56:22.012Z" and .iteration == 4)' runs.jsonl > /tmp/candidate3.json

jq -r 'select(.namespace == "jarvis:2026-06-19T16-26-24Z-classify-claude-zero-exit-quota-result" and .ts == "2026-06-19T17:26:38.755Z" and .iteration == 3)' runs.jsonl > /tmp/candidate4.json

jq -r 'select(.namespace == "jarvis:2026-06-19T17-53-54Z-stall-diagnostics-instrumentation" and .ts == "2026-06-19T18:36:25.904Z" and .iteration == 3)' runs.jsonl > /tmp/candidate5.json

echo "Candidate 1:" && cat /tmp/candidate1.json && echo ""
echo "Candidate 2:" && cat /tmp/candidate2.json && echo ""
echo "Candidate 3:" && cat /tmp/candidate3.json && echo ""
echo "Candidate 4:" && cat /tmp/candidate4.json && echo ""
echo "Candidate 5:" && cat /tmp/candidate5.json && echo ""
