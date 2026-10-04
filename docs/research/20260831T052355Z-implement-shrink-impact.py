#!/usr/bin/env python3
"""Reproduction for 20260831T052355Z-implement-shrink-impact.md.

Measures, for every v2 `implement~shrink` run, (a) whether shrink committed
changes and (b) the lines-of-code impact — from run logs and agent transcripts
only, never from git history.

Sources:
- ~/.jarvis/state/v2.sqlite          runs/attempts (population, agents)
- ~/.jarvis/state/logs.jsonl         iteration_commit events (per-iteration commits, since 2026-07-26)
- ~/.jarvis/telemetry.jsonl          work_boundary_recorded rows (boundary commits, whole window)
- ~/.jarvis/sessions/                harness session logs: pre-shrink `git diff --stat` embedded in the
                                     rendered prompt; a few runs also carry an agent tool-call stream
- ~/.cursor/chats/*/*/store.db       cursor edit-tool results (linesAdded/linesRemoved)
- ~/.codex/sessions/**.jsonl         codex apply_patch bodies (+/− line counts)
- ~/.claude/projects/<worktree>/*.jsonl  claude Edit/MultiEdit/Write tool calls

Reads live stores; output drifts from the note's snapshot as retention ages out
(claude transcripts) and the other stores grow.
"""

import difflib
import glob
import json
import os
import re
import sqlite3
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone

HOME = os.path.expanduser("~/.jarvis")
SESSIONS = os.path.join(HOME, "sessions")
MARK = "Post-completion Shrink"
ITER_COMMIT_ERA = "2026-07-26"  # first iteration_commit event; per-iteration commits landed #2104/#2176

STAT_RE = re.compile(r"^\s*(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?\s*$")
LINE_RE = re.compile(r"^\S+ \[(\w+)\] ?(.*)$")

# ---------------------------------------------------------------- phase 1: population + commit signals
db = sqlite3.connect(f"file:{os.path.join(HOME, 'state', 'v2.sqlite')}?mode=ro", uri=True)
runs = {}
for rid, project, branch, wt, created, status in db.execute(
        "SELECT id, project, branch, worktree_path, created_at, status FROM runs WHERE step_id LIKE '%~shrink'"):
    runs[rid] = {"project": project, "branch": branch, "wt": wt, "created": created, "status": status,
                 "agent": "", "iter_commits": [], "boundary_files": None,
                 "pre": None, "src": "", "edits": 0, "added": 0, "removed": 0}
for rid, agent in db.execute(
        "SELECT a.run_id, a.completion_agent FROM attempts a JOIN runs r ON a.run_id=r.id"
        " WHERE r.step_id LIKE '%~shrink' AND a.completion_agent IS NOT NULL ORDER BY a.attempt_number"):
    runs[rid]["agent"] = agent

with open(os.path.join(HOME, "state", "logs.jsonl")) as f:
    for line in f:
        if '"iteration_commit"' not in line:
            continue
        d = json.loads(line)
        r = runs.get(d.get("runId"))
        if r is not None:
            ev = d["event"]
            r["iter_commits"].append("commit" if "commitSha" in ev else ev.get("skipReason", "?"))

with open(os.path.join(HOME, "telemetry.jsonl")) as f:
    for line in f:
        if '"work_boundary_recorded"' not in line[:80]:
            continue
        d = json.loads(line)
        r = runs.get(d.get("run_id"))
        if r is not None:
            r["boundary_files"] = (r["boundary_files"] or 0) + (d.get("files_changed") or 0)

def classify_changed(r):
    if "commit" in r["iter_commits"] or r["boundary_files"] is not None:
        return "yes"
    if r["iter_commits"]:
        return "no"
    return "no" if r["status"] == "completed" else (
        "no" if utc(r["created"])[:10] >= ITER_COMMIT_ERA else "unknown")

def utc(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")

# ---------------------------------------------------------------- phase 2: harness session logs
session_files = defaultdict(list)
with os.scandir(SESSIONS) as it:
    for e in it:
        if e.name[:36] in runs:
            session_files[e.name[:36]].append(e.name)

def parse_pre_stat(path):
    """(files, ins, dels) from the prompt's rendered BRANCH_SUMMARY block, or None."""
    in_block, found = False, None
    with open(path, errors="replace") as f:
        for i, line in enumerate(f):
            if i > 400_000:
                break
            m = LINE_RE.match(line)
            if not m:
                continue
            chan, content = m.groups()
            if chan != "outbound":
                if in_block:
                    break
                continue
            if "<<<BRANCH_SUMMARY_BEGIN>>>" in content:
                in_block = True
                continue
            if in_block:
                if "<<<BRANCH_SUMMARY_END>>>" in content:
                    return found or (0, 0, 0)
                if content.strip() == "(empty)":
                    found = (0, 0, 0)
                sm = STAT_RE.match(content)
                if sm:
                    found = (int(sm.group(1)), int(sm.group(2) or 0), int(sm.group(3) or 0))
    return found

def harness_stream_loc(rid):
    """Sum edit-tool linesAdded/Removed from a harness log's inbound_stderr JSON stream, if present."""
    edits = added = removed = 0
    seen = set()
    has_stream = False
    for name in sorted(session_files.get(rid, [])):
        for line in open(os.path.join(SESSIONS, name), errors="replace"):
            i = line.find("[inbound_stderr] {")
            if i < 0:
                continue
            try:
                d = json.loads(line[i + len("[inbound_stderr] "):])
            except json.JSONDecodeError:
                continue
            if d.get("type") not in ("tool_call", "system"):
                continue
            has_stream = True
            if d.get("subtype") != "completed" or d.get("call_id") in seen:
                continue
            seen.add(d.get("call_id"))
            v = (d.get("tool_call") or {}).get("editToolCall") or {}
            res = (v.get("result") or {}).get("success")
            if not res:
                continue
            p = res.get("path") or ""
            if p.endswith("shrink-narrative.md") or "/.scratch/" in p or "/spec/" in p:
                continue
            edits += 1
            added += res.get("linesAdded") or 0
            removed += res.get("linesRemoved") or 0
    return has_stream, edits, added, removed

for rid, r in runs.items():
    for name in sorted(session_files.get(rid, [])):
        st = parse_pre_stat(os.path.join(SESSIONS, name))
        if st is not None:
            r["pre"] = st
            break

# ---------------------------------------------------------------- phase 3: native agent transcripts
by_wt = defaultdict(list)
for rid, r in runs.items():
    by_wt[r["wt"]].append((r["created"], rid))
for wt in by_wt:
    by_wt[wt].sort()

def owner(wt, ts_ms):
    """Shrink run owning a transcript: dispatch window up to the next same-worktree shrink run."""
    lst = by_wt.get(wt)
    if not lst:
        return None
    cand = None
    for i, (created, rid) in enumerate(lst):
        hi = lst[i + 1][0] if i + 1 < len(lst) else float("inf")
        if created - 120_000 <= ts_ms < hi:
            cand = rid
    return cand

def is_rendered_prompt(text):
    """The rendered shrink prompt (not a read of prompts/patch/shrink.md, which
    still contains the literal <BRANCH_DIFF> placeholder)."""
    return MARK in text and "BRANCH_SUMMARY_BEGIN" in text and "<BRANCH_DIFF>" not in text

native = defaultdict(lambda: {"edits": 0, "added": 0, "removed": 0, "src": set()})

def add_edit(rid, path, la, lr, src):
    if path.endswith("shrink-narrative.md") or "/.scratch/" in path or "/spec/" in path:
        return
    a = native[rid]
    a["src"].add(src)
    a["edits"] += 1
    a["added"] += la
    a["removed"] += lr

# codex: apply_patch bodies
PATCH_SEG = re.compile(r"\*\*\* Begin Patch(.*?)\*\*\* End Patch", re.S)

def parse_patch_segment(seg):
    if seg.count("\\n") > seg.count("\n"):
        seg = seg.replace('\\"', '"').replace("\\n", "\n").replace("\\t", "\t").replace("\\\\", "\\")
    cur, la, lr, out = None, 0, 0, []
    for line in seg.split("\n"):
        if line.startswith("*** "):
            if cur is not None:
                out.append((cur, la, lr))
            m = re.match(r"\*\*\* (?:Update|Add|Delete) File: (.*)", line)
            cur, la, lr = (m.group(1).strip() if m else None), 0, 0
        elif cur is not None and not line.startswith(("@@", "+++", "---")):
            la += line.startswith("+")
            lr += line.startswith("-")
    if cur is not None:
        out.append((cur, la, lr))
    return out

for p in glob.glob(os.path.expanduser("~/.codex/sessions/2026/*/*/*.jsonl")):
    try:
        with open(p, errors="replace") as f:
            meta = json.loads(f.readline())
            if (meta.get("payload") or {}).get("cwd") not in by_wt:
                continue
            body = f.read()
    except (OSError, json.JSONDecodeError):
        continue
    if not any(('"user_message"' in ln or '"role":"user"' in ln) and is_rendered_prompt(ln)
               for ln in body.split("\n") if MARK in ln):
        continue
    ts_ms = datetime.fromisoformat(meta["timestamp"].replace("Z", "+00:00")).timestamp() * 1000
    rid = owner((meta.get("payload") or {}).get("cwd"), ts_ms)
    if rid is None:
        continue
    for line in body.split("\n"):
        if "Begin Patch" not in line:
            continue
        try:
            pl = json.loads(line).get("payload") or {}
        except json.JSONDecodeError:
            continue
        if pl.get("type") not in ("custom_tool_call", "function_call", "local_shell_call"):
            continue
        blob = pl.get("input") or pl.get("arguments") or json.dumps(pl.get("action") or {})
        for seg in PATCH_SEG.findall(blob):
            for path, la, lr in parse_patch_segment(seg):
                add_edit(rid, path or "", la, lr, "codex")

# claude: project transcripts
def diff_counts(old, new):
    la = lr = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
            None, old.split("\n"), new.split("\n"), autojunk=False).get_opcodes():
        if tag in ("replace", "delete"):
            lr += i2 - i1
        if tag in ("replace", "insert"):
            la += j2 - j1
    return la, lr

for wt in by_wt:
    pd = os.path.join(os.path.expanduser("~/.claude/projects"), re.sub(r"[^A-Za-z0-9]", "-", wt))
    for sp in glob.glob(os.path.join(pd, "*.jsonl")):
        body = open(sp, errors="replace").read()
        if not any('"type":"user"' in ln and is_rendered_prompt(ln) for ln in body.split("\n") if MARK in ln):
            continue
        m = re.search(r'"timestamp":"([^"]+)"', body)
        rid = owner(wt, datetime.fromisoformat(m.group(1).replace("Z", "+00:00")).timestamp() * 1000) if m else None
        if rid is None:
            continue
        for line in body.split("\n"):
            if '"tool_use"' not in line:
                continue
            try:
                msg = json.loads(line).get("message") or {}
            except json.JSONDecodeError:
                continue
            content = msg.get("content")
            for item in content if isinstance(content, list) else []:
                if not isinstance(item, dict) or item.get("type") != "tool_use":
                    continue
                inp = item.get("input") or {}
                fp = inp.get("file_path") or ""
                if item.get("name") == "Edit":
                    add_edit(rid, fp, *diff_counts(inp.get("old_string") or "", inp.get("new_string") or ""), "claude")
                elif item.get("name") == "MultiEdit":
                    for e in inp.get("edits") or []:
                        add_edit(rid, fp, *diff_counts(e.get("old_string") or "", e.get("new_string") or ""), "claude")
                elif item.get("name") == "Write":
                    c = inp.get("content") or ""
                    add_edit(rid, fp, c.count("\n") + 1 if c else 0, 0, "claude")

# cursor: chat stores
CUR_REC = re.compile(r'"success":\{"path":"([^"]+)","linesAdded":(\d+),"linesRemoved":(\d+)')
CUR_ID = re.compile(r'"id":"(tool_[0-9a-f-]+)"')
for mp in glob.glob(os.path.expanduser("~/.cursor/chats/*/*/meta.json")):
    try:
        meta = json.load(open(mp))
    except (OSError, json.JSONDecodeError):
        continue
    rid = owner(meta.get("cwd"), meta.get("createdAtMs") or 0) if meta.get("cwd") in by_wt else None
    if rid is None:
        continue
    try:
        c = sqlite3.connect(f"file:{os.path.join(os.path.dirname(mp), 'store.db')}?mode=ro&immutable=1", uri=True)
        mark_blobs = c.execute("SELECT data FROM blobs WHERE data LIKE ? LIMIT 20", (f"%{MARK}%",)).fetchall()
        decode = lambda b: b.decode("utf-8", "replace") if isinstance(b, (bytes, bytearray)) else b
        if not any('"role":"user"' in decode(b) and "# Patch Mode — Post-completion Shrink" in decode(b)
                   and "<BRANCH_DIFF>" not in decode(b) for (b,) in mark_blobs):
            continue
        rows = c.execute("SELECT data FROM blobs WHERE data LIKE '%linesAdded%'").fetchall()
    except sqlite3.Error:
        continue
    seen = set()
    for (b,) in rows:
        s = decode(b)
        for m2 in CUR_REC.finditer(s):
            idm = CUR_ID.findall(s[max(0, m2.start() - 1500):m2.start()])
            key = (idm[-1] if idm else None, m2.group(1), m2.group(2), m2.group(3))
            if key not in seen:
                seen.add(key)
                add_edit(rid, m2.group(1), int(m2.group(2)), int(m2.group(3)), "cursor")

# ---------------------------------------------------------------- phase 4: merge + report
for rid, r in runs.items():
    n = native.get(rid)
    if n and n["edits"] > 0:
        r["src"], r["edits"], r["added"], r["removed"] = "+".join(sorted(n["src"])), n["edits"], n["added"], n["removed"]
    else:
        has_stream, edits, added, removed = harness_stream_loc(rid)
        if n:
            r["src"] = "+".join(sorted(n["src"])) + "(empty)"
        elif has_stream:
            r["src"], r["edits"], r["added"], r["removed"] = "harness-stream", edits, added, removed
    r["changed"] = classify_changed(r)

def stats(name, xs):
    if not xs:
        print(f"   {name}: n=0")
        return
    q = statistics.quantiles(sorted(xs), n=4) if len(xs) > 1 else [xs[0]] * 3
    print(f"   {name}: n={len(xs)} sum={sum(xs)} mean={statistics.mean(xs):.1f}"
          f" median={statistics.median(xs):.0f} p25={q[0]:.0f} p75={q[2]:.0f} min={min(xs)} max={max(xs)}")

out = list(runs.values())
print(f"total shrink runs: {len(out)}", Counter(r["status"] for r in out))
print("changed:", Counter(r["changed"] for r in out))
changed = [r for r in out if r["changed"] == "yes"]
act = [r for r in changed if r["src"] and r["edits"] > 0]
print(f"changed runs: {len(changed)}; with usable LOC evidence: {len(act)}; by source:",
      Counter(r["src"] for r in act))
stats("added", [r["added"] for r in act])
stats("removed", [r["removed"] for r in act])
nets = [r["added"] - r["removed"] for r in act]
stats("net", nets)
stats("churn", [r["added"] + r["removed"] for r in act])
print(f"   net<0: {sum(1 for x in nets if x < 0)}  net=0: {nets.count(0)}  net>0: {sum(1 for x in nets if x > 0)}")
nc = [r for r in out if r["changed"] == "no" and r["edits"] > 0]
print(f"edited but never committed: {len(nc)}")
pre = [r for r in act if r["pre"]]
if pre:
    print(f"median pre-shrink branch insertions: {statistics.median(r['pre'][1] for r in pre):.0f};"
          f" aggregate net/pre: {sum(r['added'] - r['removed'] for r in pre) / sum(r['pre'][1] for r in pre) * 100:.1f}%")
for label, key in (("month", lambda r: utc(r["created"])[:7]), ("agent", lambda r: r["agent"] or "?"),
                   ("project", lambda r: r["project"])):
    print(f"by {label}:")
    groups = defaultdict(list)
    for r in act:
        groups[key(r)].append(r["added"] - r["removed"])
    for g in sorted(groups):
        stats(g, groups[g])
