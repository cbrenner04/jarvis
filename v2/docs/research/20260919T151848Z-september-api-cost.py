"""Summarize invocation time and token-derived API cost; emit JSON to stdout."""

import argparse
import collections
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3


FIELDS = {
    "input_tokens": "input_per_mtok",
    "output_tokens": "output_per_mtok",
    "cache_read_input_tokens": "cache_read_per_mtok",
    "cache_creation_input_tokens": "cache_write_per_mtok",
}


def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamps must include a timezone")
    return parsed


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def summarize(rows):
    priced = [r for r in rows if r["api_cost"] is not None]
    paired = [r for r in priced if numeric(r.get("cost_usd"))]
    return {
        "calls": len(rows),
        "runs": len({r["run_id"] for r in rows}),
        "hours": sum(r["duration_ms"] for r in rows) / 3_600_000,
        "priced_calls": len(priced),
        "priced_hours": sum(r["duration_ms"] for r in priced) / 3_600_000,
        "complete_usage_calls": sum(all(v is not None for v in r["usage"].values()) for r in rows),
        "api_cost": sum(r["api_cost"] for r in priced) if priced else None,
        "tokens": {k: sum(r["usage"][k] for r in rows if r["usage"][k] is not None) for k in FIELDS},
        "token_coverage_calls": {k: sum(r["usage"][k] is not None for r in rows) for k in FIELDS},
        "cost_components": {k: sum(r["components"][k] for r in priced) if priced else None for k in FIELDS},
        "paired_calls": len(paired),
        "paired_api_cost": sum(r["api_cost"] for r in paired) if paired else None,
        "paired_returned_cost": sum(r["cost_usd"] for r in paired) if paired else None,
        "paired_delta": sum(r["api_cost"] - r["cost_usd"] for r in paired) if paired else None,
    }


def partition(rows, key):
    groups = collections.defaultdict(list)
    for row in rows:
        groups[key(row)].append(row)
    result = {label: summarize(group) for label, group in sorted(groups.items())}
    total = summarize(rows)
    for metric in ("calls", "hours", "priced_calls", "priced_hours", "api_cost"):
        assert math.isclose(sum(group[metric] or 0 for group in result.values()), total[metric] or 0, abs_tol=1e-8)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--telemetry", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True, help="SQLite backup of the state database")
    parser.add_argument("--prices", type=Path, required=True)
    parser.add_argument("--project", default="jarvis")
    parser.add_argument("--start", default="2026-09-01T00:00:00Z")
    parser.add_argument("--end", required=True, help="exclusive ISO-8601 cutoff, including timezone")
    args = parser.parse_args()
    start, end = timestamp(args.start), timestamp(args.end)
    if start >= end:
        parser.error("start must precede end")
    raw, price_bytes = args.telemetry.read_bytes(), args.prices.read_bytes()
    prices = json.loads(price_bytes)["models"]
    diagnostics = collections.Counter(dict.fromkeys(("malformed_records_entire_file", "invalid_timestamps_project", "selected_records_before_dedup", "missing_ids", "duplicate_ids", "unknown_or_unpriced_binding", "missing_run_join", "missing_attempt_join", "attempt_run_mismatch"), 0))
    seen, rows, used_prices = {}, [], {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError("record must be an object")
        except (ValueError, UnicodeError):
            diagnostics["malformed_records_entire_file"] += 1
            continue
        if row.get("record_kind") != "invocation_completed" or row.get("project") != args.project:
            continue
        try:
            emitted = timestamp(row["ts"])
        except (KeyError, TypeError, ValueError, AttributeError):
            diagnostics["invalid_timestamps_project"] += 1
            continue
        if not start <= emitted < end:
            continue
        diagnostics["selected_records_before_dedup"] += 1
        if any(not isinstance(row.get(k), str) or not row[k] for k in ("invocation_id", "run_id", "attempt_id")):
            diagnostics["missing_ids"] += 1
            continue
        identity = row["invocation_id"]
        if identity in seen:
            diagnostics["duplicate_ids"] += 1
            if seen[identity] != row:
                raise ValueError("conflicting duplicate invocation_id; resolve before analysis")
            continue
        seen[identity] = dict(row)
        if not numeric(row.get("duration_ms")):
            raise ValueError("selected invocation has invalid duration_ms")
        usage = row.get("usage")
        if usage is None:
            usage = {}
        if not isinstance(usage, dict):
            raise ValueError("selected invocation has invalid usage")
        row["usage"] = {k: usage.get(k) for k in FIELDS}
        if any(v is not None and not numeric(v) for v in row["usage"].values()):
            raise ValueError("selected invocation has invalid token count")
        binding_id = row.get("binding_id")
        binding = binding_id.split("/") if isinstance(binding_id, str) else []
        price_key = binding[-1] if len(binding) >= 3 else None
        rates = prices.get(price_key)
        row["api_cost"], row["components"] = None, {}
        if rates is None or not any(numeric(rates.get(k)) for k in FIELDS.values()):
            diagnostics["unknown_or_unpriced_binding"] += 1
        else:
            used_prices[price_key] = rates
            if any(v is not None for v in row["usage"].values()):
                # Match computeCost's arithmetic; coverage still distinguishes null from measured zero.
                for token, rate_key in FIELDS.items():
                    rate = rates.get(rate_key)
                    if rate is None:
                        rate = (rates.get("input_per_mtok") or 0) if token.startswith("cache_") else 0
                    if not numeric(rate):
                        raise ValueError("invalid catalog rate")
                    row["components"][token] = (row["usage"][token] or 0) * rate / 1_000_000
                row["api_cost"] = sum(row["components"].values())
        rows.append(row)

    with sqlite3.connect(args.state.resolve().as_uri() + "?mode=ro", uri=True) as db:
        attempts = {r[0]: (r[1], r[2]) for r in db.execute("SELECT id, run_id, attempt_number FROM attempts")}
        run_ids = {r[0] for r in db.execute("SELECT id FROM runs")}
    repeats = collections.Counter()
    for row in rows:
        attempt = attempts.get(row["attempt_id"])
        diagnostics["missing_run_join"] += row["run_id"] not in run_ids
        diagnostics["missing_attempt_join"] += attempt is None
        mismatch = attempt is not None and attempt[0] != row["run_id"]
        diagnostics["attempt_run_mismatch"] += mismatch
        row["attempt_group"] = "unknown" if attempt is None or mismatch else "later attempt" if attempt[1] > 1 else "first attempt"
        binding_index = row.get("binding_index")
        if not isinstance(binding_index, int) or isinstance(binding_index, bool) or binding_index < 0:
            raise ValueError("invalid binding_index")
        row["binding_group"] = "fallback" if binding_index > 0 else "first binding"
        if binding_index == 0:
            # Re-prompts and repeated review calls are not necessarily new attempts.
            repeats[(row["run_id"], row["attempt_id"], row.get("role"))] += 1

    result = {
        "window": {"project": args.project, "start_inclusive": args.start, "end_exclusive": args.end, "timestamp_basis": "emission ts"},
        "fingerprints": {"telemetry_sha256": hashlib.sha256(raw).hexdigest(), "prices_sha256": hashlib.sha256(price_bytes).hexdigest(), "state_sha256": hashlib.sha256(args.state.read_bytes()).hexdigest()},
        "diagnostics": dict(diagnostics),
        "price_rows": used_prices,
        "total": summarize(rows),
        "by_role": partition(rows, lambda r: r["role"]),
        "by_step_role": partition(rows, lambda r: " / ".join((r["workflow"], re.sub(r"~link-\d+$", "~link-*", r.get("step_id") or "(none)"), r["role"]))),
        "by_agent_model": partition(rows, lambda r: f'{r["agent"]} / {r["model"]}'),
        "by_exit": partition(rows, lambda r: r["exit_kind"]),
        "by_binding": partition(rows, lambda r: r["binding_group"]),
        "by_attempt": partition(rows, lambda r: r["attempt_group"]),
        "by_attempt_binding": partition(rows, lambda r: r["attempt_group"] + " / " + r["binding_group"]),
        "repeated_first_binding_calls_within_attempt_role": sum(n - 1 for n in repeats.values()),
    }
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
