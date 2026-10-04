"""Audit frozen Claude transcripts against telemetry; emit aggregate research evidence as JSON.

Pass a copied Claude projects directory, not a changing live store. Only root
*/*.jsonl files are invocation candidates; nested subagents are priced separately.
No transcript text or tool arguments are emitted. Rates are the study's explicit
comparison assumptions, not a live pricing lookup.
"""

import argparse
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import statistics

TOKENS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
REVIEW = {"critic", "adversary", "advocate", "adjudicator", "actuator"}
RATES = {"claude-sonnet-5": (2, 10), "claude-opus-5": (5, 25),
         "claude-haiku-4-5-20251001": (1, 5), "claude-haiku-4-5": (1, 5)}


def stamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone required")
    return parsed.timestamp()


def text_content(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(v.get("text", "") for v in value if isinstance(v, dict) and v.get("type") == "text")
    return ""


def read_native(path):
    raw = path.read_bytes()
    records = [json.loads(line) for line in raw.splitlines() if line.strip()]
    users = [r for r in records if r.get("type") == "user" and not r.get("isSidechain")
             and isinstance(r.get("message", {}).get("content"), str) and r.get("timestamp")]
    return {"path": path, "sha256": hashlib.sha256(raw).hexdigest(), "records": records,
            "first": stamp(users[0]["timestamp"]) if users else None,
            "cwd": users[0].get("cwd") if users else None}


def messages(records):
    unique = {}
    for r in records:
        m = r.get("message", {})
        if r.get("type") != "assistant" or not m.get("id") or not m.get("usage"):
            continue
        old = unique.get(m["id"])
        if old is None or (m["usage"].get("output_tokens") or 0) >= (old["usage"].get("output_tokens") or 0):
            unique[m["id"]] = m
    return list(unique.values())


def usage_totals(msgs):
    return {k: sum(m["usage"].get(k) or 0 for m in msgs) for k in TOKENS}


def bounded(records, start, end):
    return [r for r in records if r.get("timestamp") and start <= stamp(r["timestamp"]) <= end]


def current_cost(msgs):
    total = 0
    for m in msgs:
        model, u = m["model"], m["usage"]
        if model == "<synthetic>" and not any(u.get(k) for k in TOKENS):
            continue
        a, o = RATES[model]  # Fail on unknown models, never silently value them at zero.
        cache = u.get("cache_creation", {})
        five, hour = cache.get("ephemeral_5m_input_tokens", 0), cache.get("ephemeral_1h_input_tokens", 0)
        if five + hour != (u.get("cache_creation_input_tokens") or 0):
            raise ValueError("cache TTL breakdown incomplete")
        total += ((u.get("input_tokens") or 0) * a + (u.get("output_tokens") or 0) * o
                  + (u.get("cache_read_input_tokens") or 0) * a / 10 + five * a * 1.25 + hour * a * 2) / 1e6
    return total


def catalog_cost(row, prices):
    rates = prices[row["binding_id"].rsplit("/", 1)[-1]]
    u = row["usage"]
    if not any(v is not None for v in u.values()):
        return None
    rate_keys = ("input_per_mtok", "output_per_mtok", "cache_read_per_mtok", "cache_write_per_mtok")
    return sum((u[k] or 0) * (rates.get(v) if rates.get(v) is not None else
               (rates.get("input_per_mtok") or 0) if k.startswith("cache_") else 0)
               for k, v in zip(TOKENS, rate_keys)) / 1e6


def summary(rows, prices):
    costs = [catalog_cost(r, prices) for r in rows]
    return {"calls": len(rows), "minutes": sum(r["duration_ms"] for r in rows) / 60000,
            "priced_calls": sum(c is not None for c in costs),
            "catalog_cost": sum(c for c in costs if c is not None) if any(c is not None for c in costs) else None}


def distribution(values):
    values = sorted(values)
    return {"n": len(values), "median": statistics.median(values),
            "p90": values[max(0, (9 * len(values) + 9) // 10 - 1)], "max": max(values)} if values else None


def tool_evidence(records):
    tools, results = {}, {}
    for r in records:
        content = r.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for b in content:
            if b.get("type") == "tool_use":
                tools[b["id"]] = b
            elif b.get("type") == "tool_result":
                results[b["tool_use_id"]] = b
    reads = [t.get("input", {}).get("file_path") for t in tools.values() if t.get("name") == "Read"]
    edits = [t for t in tools.values() if t.get("name") in {"Edit", "Write", "MultiEdit"}]
    return {"tool_calls": len(tools), "tools": dict(Counter(t.get("name") for t in tools.values())),
            "tool_result_chars": sum(len(text_content(r.get("content"))) for r in results.values()),
            "tool_error_results": sum(bool(r.get("is_error")) for r in results.values()),
            "repeat_read_paths": len(reads) - len(set(reads)),
            "successful_edit_tools": sum(t["id"] in results and not results[t["id"]].get("is_error") for t in edits)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for flag in ("telemetry", "prices", "transcripts"):
        p.add_argument("--" + flag, type=Path, required=True)
    p.add_argument("--start", default="2026-09-01T00:00:00Z")
    p.add_argument("--end", required=True)
    p.add_argument("--project", default="jarvis")
    args = p.parse_args()
    start, end = stamp(args.start), stamp(args.end)
    if start >= end:
        p.error("start must precede end")
    raw = args.telemetry.read_bytes()
    price_bytes = args.prices.read_bytes()
    prices = json.loads(price_bytes)["models"]
    rows = {}
    for line in raw.splitlines():
        r = json.loads(line)
        if r.get("record_kind") != "invocation_completed" or r.get("project") != args.project:
            continue
        if start <= stamp(r["ts"]) < end:
            identity = r["invocation_id"]
            if identity in rows and rows[identity] != r:
                raise ValueError("conflicting invocation ID")
            rows[identity] = r
    by_cwd = defaultdict(list)
    for r in rows.values():
        if r["agent"] == "claude":
            by_cwd[r["worktree_path"]].append(r)
    matches, fingerprints = defaultdict(list), {}
    ambiguous = 0
    for path in sorted(args.transcripts.glob("*/*.jsonl")):
        native = read_native(path)
        if native["first"] is None:
            continue
        candidates = [r for r in by_cwd.get(native["cwd"], []) if
                      stamp(r["ts"]) - r["duration_ms"] / 1000 - 2 <= native["first"] <= stamp(r["ts"]) + 2]
        if not candidates:
            continue
        totals = usage_totals(messages(native["records"]))
        exact = [r for r in candidates if totals == r["usage"]]
        strict = [r for r in candidates if stamp(r["ts"]) - r["duration_ms"] / 1000 <= native["first"] <= stamp(r["ts"])]
        chosen = exact or strict
        if len(chosen) != 1:
            ambiguous += 1
            continue
        matches[chosen[0]["invocation_id"]].append(native)
        fingerprints[str(path.relative_to(args.transcripts))] = native["sha256"]
    collisions = sum(len(v) > 1 for v in matches.values())
    matches = {k: v[0] for k, v in matches.items() if len(v) == 1}
    reconciled, mismatch, metrics = [], [], []
    tool_stats = {}
    for iid, native in matches.items():
        row = rows[iid]
        finish = stamp(row["ts"])
        records = bounded(native["records"], finish - row["duration_ms"] / 1000 - 2, finish)
        msgs = messages(records)
        stats = tool_evidence(records)
        tool_stats[iid] = stats
        if row.get("cost_usd") is None:
            continue
        if usage_totals(msgs) != row["usage"]:
            mismatch.append(iid)
            continue
        child_cost, child_files = 0, 0
        for path in sorted(native["path"].with_suffix("").rglob("*.jsonl")):
            child = read_native(path)
            fingerprints[str(path.relative_to(args.transcripts))] = child["sha256"]
            child_cost += current_cost(messages(bounded(child["records"], finish - row["duration_ms"] / 1000 - 2, finish)))
            child_files += 1
        root_cost = current_cost(msgs)
        reconciled.append({"invocation_id": iid, "model": row["model"], "catalog": catalog_cost(row, prices),
                           "root_corrected": root_cost, "child": child_cost, "child_files": child_files,
                           "returned": row["cost_usd"], "residual": row["cost_usd"] - root_cost - child_cost,
                           "onehour": sum(m["usage"].get("cache_creation", {}).get("ephemeral_1h_input_tokens", 0) for m in msgs),
                           "fivemin": sum(m["usage"].get("cache_creation", {}).get("ephemeral_5m_input_tokens", 0) for m in msgs)})
        first_user = next(r for r in records if r.get("type") == "user" and isinstance(r.get("message", {}).get("content"), str))
        metrics.append({"invocation_id": iid, "role": row["role"], "workflow": row["workflow"],
                        "prompt_chars": len(first_user["message"]["content"]), "responses": len(msgs),
                        "input_context_per_response": sum((row["usage"][k] or 0) for k in TOKENS if k != "output_tokens") / len(msgs),
                        **stats})
    cost_groups = defaultdict(Counter)
    for r in reconciled:
        g = cost_groups[r["model"]]
        g["calls"] += 1
        for key in ("catalog", "root_corrected", "child", "returned", "residual", "onehour", "fivemin"):
            g[key] += r[key]
        g["calls_with_child"] += r["child_files"] > 0
    role_metrics = {}
    for role in sorted({m["role"] for m in metrics}):
        ms = [m for m in metrics if m["role"] == role]
        role_metrics[role] = {key: distribution([m[key] for m in ms]) for key in
                              ("prompt_chars", "responses", "input_context_per_response", "tool_result_chars", "repeat_read_paths")}
    review = [r for r in rows.values() if r["role"] in REVIEW]
    groups = defaultdict(list)
    for r in review:
        groups[(r["workflow"], r["run_id"], r["attempt_id"])].append(r)
    selected = []
    for workflow in ("intent", "plan", "implement"):
        eligible = [rs for (w, _, _), rs in groups.items() if w == workflow and all(r["invocation_id"] in matches for r in rs)
                    and any(r["role"] == "actuator" for r in rs)
                    and any(r["role"] in {"critic", "adjudicator"} for r in rs)]
        for rs in sorted(eligible, key=lambda rs: max(r["ts"] for r in rs), reverse=True)[:4]:
            selected.append({"workflow": workflow, "run_id": rs[0]["run_id"], "attempt_id": rs[0]["attempt_id"],
                             "task": Path(rs[0]["worktree_path"]).name, **summary(rs, prices),
                             "invocations": [{"id": r["invocation_id"], "role": r["role"], **tool_stats[r["invocation_id"]]} for r in rs]})
    pilot = []
    for r in sorted((r for r in rows.values() if r["role"] == "implement" and r["exit_kind"] != "ok"),
                    key=lambda r: r["duration_ms"], reverse=True)[:4]:
        entry = {k: r[k] for k in ("invocation_id", "run_id", "agent", "duration_ms", "ts", "exit_kind")}
        if r["invocation_id"] in matches:
            finish = stamp(r["ts"])
            records = matches[r["invocation_id"]]["records"]
            times = sorted(stamp(v["timestamp"]) for v in bounded(records, finish - r["duration_ms"] / 1000, finish))
            entry["largest_event_gap_minutes"] = max((b - a for a, b in zip(times, times[1:])), default=0) / 60
            entry["post_settlement_timestamped_records"] = sum(stamp(v["timestamp"]) > finish for v in records if v.get("timestamp"))
        pilot.append(entry)
    print(json.dumps({"window": {"start": args.start, "end": args.end, "project": args.project},
                      "telemetry_sha256": hashlib.sha256(raw).hexdigest(),
                      "prices_sha256": hashlib.sha256(price_bytes).hexdigest(), "source_fingerprints": fingerprints,
                      "coverage": {"claude_rows": sum(len(v) for v in by_cwd.values()), "matched": len(matches),
                                   "ambiguous_files": ambiguous, "invocation_collisions": collisions,
                                   "usage_exact_priced": len(reconciled), "usage_mismatch_ids": mismatch},
                      "comparison_rates_input_output": RATES, "reconciliation": dict(cost_groups),
                      "reconciled_rows": reconciled, "transcript_metrics": role_metrics,
                      "review_total": summary(review, prices),
                      "review_by_workflow": {w: summary([r for r in review if r["workflow"] == w], prices) for w in sorted({r["workflow"] for r in review})},
                      "review_sample": selected, "duration_pilot": pilot}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
