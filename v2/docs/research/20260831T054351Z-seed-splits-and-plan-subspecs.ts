// Mines git history for seed→intent split factors and plan→subspec counts.
// Run from the repo root: bun v2/docs/research/20260831T054351Z-seed-splits-and-plan-subspecs.ts
// Reads the live git history; rerunning later will drift from the note's snapshot.

const SPEC_RE = /^(v[12])\/spec\/(.+)$/;
// wip-intents was the pre-ready-intents intent workspace, not a spec dir.
const SPECIAL_DIRS = new Set(["seeds", "ready-intents", "completed", "wip-intents"]);
// Subspecs are always NN-*.md; everything else in a spec dir is index.md, intent.md, or a review artifact (verdict-*.md).
const SUBSPEC_RE = /^\d{2}-.*\.md$/;

type Change = { status: string; path: string; toPath?: string };
type Commit = { hash: string; date: string; subject: string; changes: Change[] };

async function gitLog(): Promise<Commit[]> {
  const proc = Bun.spawn(
    [
      "git",
      "log",
      "--first-parent",
      "--diff-merges=first-parent",
      "--find-renames",
      "--name-status",
      "--date=short",
      "--format=COMMIT|%H|%ad|%s",
    ],
    { stdout: "pipe" },
  );
  const text = await new Response(proc.stdout).text();
  const commits: Commit[] = [];
  let current: Commit | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("COMMIT|")) {
      const [, hash, date, ...rest] = line.split("|");
      current = { hash: hash ?? "", date: date ?? "", subject: rest.join("|"), changes: [] };
      commits.push(current);
      continue;
    }
    if (!current || line.trim() === "") continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    if (status.startsWith("R") || status.startsWith("C")) {
      current.changes.push({ status: status[0] ?? "", path: parts[1] ?? "", toPath: parts[2] ?? "" });
    } else if (parts.length === 2) {
      current.changes.push({ status, path: parts[1] ?? "" });
    }
  }
  return commits.reverse(); // oldest first
}

function specParts(path: string): { version: string; rest: string } | undefined {
  const m = SPEC_RE.exec(path);
  if (!m) return undefined;
  return { version: m[1] ?? "", rest: m[2] ?? "" };
}

type SplitEvent = {
  hash: string;
  date: string;
  subject: string;
  version: string;
  intents: string[];
  seedsDeleted: string[];
};
type PlanEvent = {
  hash: string;
  date: string;
  subject: string;
  version: string;
  dir: string;
  subspecs: number;
  consumedIntents: string[];
};

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? Number.NaN;
}

function stats(values: number[]): string {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return `n=${s.length} min=${s[0]} p50=${pct(s, 50)} mean=${mean.toFixed(2)} p90=${pct(s, 90)} max=${s[s.length - 1]}`;
}

function histogram(values: number[]): string {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, c]) => `${k}:${c} (${((100 * c) / values.length).toFixed(0)}%)`)
    .join("  ");
}

function monthly(events: { date: string; value: number }[]): void {
  const byMonth = new Map<string, number[]>();
  for (const e of events) {
    const month = e.date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), e.value]);
  }
  for (const [month, vals] of [...byMonth.entries()].sort()) {
    const s = [...vals].sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    console.log(`  ${month}: n=${s.length} p50=${pct(s, 50)} mean=${mean.toFixed(2)} max=${s[s.length - 1]}`);
  }
}

const commits = await gitLog();
const splits: SplitEvent[] = [];
const plans: PlanEvent[] = [];
const dirCreated = new Set<string>(); // `${version}/${dir}`
let seedsAdded = 0;
let seedDeletionsOutsideSplits = 0;
const amendments = new Map<string, number>(); // spec dir key → subspecs added after creation
const amendmentEvents: { date: string; value: number }[] = [];

for (const commit of commits) {
  const intentAdds = new Map<string, string[]>(); // version → basenames
  const seedDels = new Map<string, string[]>();
  const intentDels = new Map<string, string[]>(); // version → basenames (D or R-from)
  const indexAdds: { version: string; dir: string }[] = [];
  const subspecAdds = new Map<string, number>(); // `${version}/${dir}` → count
  const intentRenamedInto = new Map<string, string[]>(); // `${version}/${dir}` → intent basenames

  for (const change of commit.changes) {
    const from = specParts(change.path);
    if (from) {
      const [head, ...tail] = from.rest.split("/");
      const base = tail[tail.length - 1];
      if (head === "ready-intents" && tail.length === 1 && base?.endsWith(".md")) {
        if (change.status === "A") intentAdds.set(from.version, [...(intentAdds.get(from.version) ?? []), base]);
        if (change.status === "D" || change.status === "R")
          intentDels.set(from.version, [...(intentDels.get(from.version) ?? []), base]);
        if (change.status === "R" && change.toPath) {
          const to = specParts(change.toPath);
          if (to) {
            const [toDir, toFile] = to.rest.split("/");
            if (toFile === "intent.md" && toDir !== undefined) {
              const key = `${to.version}/${toDir}`;
              intentRenamedInto.set(key, [...(intentRenamedInto.get(key) ?? []), base]);
            }
          }
        }
      } else if (head === "seeds" && tail.length === 1 && base?.endsWith(".md")) {
        if (change.status === "A") seedsAdded += 1;
        if (change.status === "D" || change.status === "R")
          seedDels.set(from.version, [...(seedDels.get(from.version) ?? []), base]);
      } else if (head !== undefined && !SPECIAL_DIRS.has(head) && tail.length === 1 && change.status === "A") {
        if (base === "index.md") indexAdds.push({ version: from.version, dir: head });
        else if (base !== undefined && SUBSPEC_RE.test(base)) {
          const key = `${from.version}/${head}`;
          subspecAdds.set(key, (subspecAdds.get(key) ?? 0) + 1);
        }
      }
    }
  }

  for (const [version, intents] of intentAdds) {
    splits.push({
      hash: commit.hash.slice(0, 8),
      date: commit.date,
      subject: commit.subject,
      version,
      intents,
      seedsDeleted: seedDels.get(version) ?? [],
    });
  }
  for (const [version, dels] of seedDels) {
    if (!intentAdds.has(version)) seedDeletionsOutsideSplits += dels.length;
  }
  for (const { version, dir } of indexAdds) {
    const key = `${version}/${dir}`;
    dirCreated.add(key);
    const consumed = [...(intentRenamedInto.get(key) ?? [])];
    // Fallback link: a deleted ready-intent whose stem matches the dir suffix, or the only deletion.
    if (consumed.length === 0) {
      const dels = intentDels.get(version) ?? [];
      const stemOf = (d: string) => d.replace(/^\d{8}T\d{6}Z-/, "").replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-/, "");
      const match = dels.filter((b) => b.replace(/\.md$/, "") === stemOf(dir));
      if (match.length > 0) consumed.push(...match);
      else if (dels.length === 1 && indexAdds.length === 1) consumed.push(...dels);
    }
    plans.push({
      hash: commit.hash.slice(0, 8),
      date: commit.date,
      subject: commit.subject,
      version,
      dir,
      subspecs: subspecAdds.get(key) ?? 0,
      consumedIntents: consumed,
    });
  }
  for (const [key, count] of subspecAdds) {
    const inThisCommit = indexAdds.some(({ version, dir }) => `${version}/${dir}` === key);
    if (!inThisCommit && dirCreated.has(key)) {
      amendments.set(key, (amendments.get(key) ?? 0) + count);
      amendmentEvents.push({ date: commit.date, value: count });
    }
  }
}

console.log("== Seed → intent splits ==");
const splitCounts = splits.map((s) => s.intents.length);
console.log(`all: ${stats(splitCounts)}`);
console.log(`histogram: ${histogram(splitCounts)}`);
for (const version of ["v1", "v2"]) {
  const vals = splits.filter((s) => s.version === version).map((s) => s.intents.length);
  if (vals.length > 0) console.log(`${version}: ${stats(vals)}`);
}
const withSeed = splits.filter((s) => s.seedsDeleted.length === 1);
console.log(
  `splits deleting exactly one seed: ${withSeed.length}/${splits.length}; zero: ${splits.filter((s) => s.seedsDeleted.length === 0).length}; multi: ${splits.filter((s) => s.seedsDeleted.length > 1).length}`,
);
console.log(`intent-titled subjects: ${splits.filter((s) => /^intent\b/i.test(s.subject)).length}/${splits.length}`);
console.log(`seeds ever added: ${seedsAdded}; seed deletions outside split commits: ${seedDeletionsOutsideSplits}`);
console.log("monthly (intents per split):");
monthly(splits.map((s) => ({ date: s.date, value: s.intents.length })));
console.log("monthly (share of splits deleting exactly one seed):");
{
  const byMonth = new Map<string, { one: number; total: number }>();
  for (const s of splits) {
    const m = s.date.slice(0, 7);
    const row = byMonth.get(m) ?? { one: 0, total: 0 };
    row.total += 1;
    if (s.seedsDeleted.length === 1) row.one += 1;
    byMonth.set(m, row);
  }
  for (const [m, r] of [...byMonth.entries()].sort()) console.log(`  ${m}: ${r.one}/${r.total}`);
}

console.log("\n== Plan → subspecs ==");
const planCounts = plans.map((p) => p.subspecs);
console.log(`all: ${stats(planCounts)}`);
console.log(`histogram: ${histogram(planCounts)}`);
for (const version of ["v1", "v2"]) {
  const vals = plans.filter((p) => p.version === version).map((p) => p.subspecs);
  if (vals.length > 0) console.log(`${version}: ${stats(vals)}`);
}
const planTitled = plans.filter((p) => /\bplan\b/i.test(p.subject));
console.log(`plan-titled subjects: ${planTitled.length}/${plans.length} — ${stats(planTitled.map((p) => p.subspecs))}`);
const other = plans.filter((p) => !/\bplan\b/i.test(p.subject));
if (other.length > 0) console.log(`other subjects: ${stats(other.map((p) => p.subspecs))}`);
console.log(
  `plans consuming a linked ready-intent: ${plans.filter((p) => p.consumedIntents.length > 0).length}/${plans.length}`,
);
console.log(
  `zero-subspec dir creations: ${
    plans
      .filter((p) => p.subspecs === 0)
      .map((p) => `${p.hash}:${p.dir}`)
      .join(", ") || "none"
  }`,
);
const amendedTotal = [...amendments.values()].reduce((a, b) => a + b, 0);
console.log(`dirs amended after creation: ${amendments.size} (+${amendedTotal} subspecs)`);
console.log("amendment months:");
monthly(amendmentEvents);
console.log("monthly (subspecs per plan):");
monthly(plans.map((p) => ({ date: p.date, value: p.subspecs })));

console.log("\n== Composed: subspecs per seed ==");
const subspecsByIntent = new Map<string, number>();
for (const p of plans) for (const intent of p.consumedIntents) subspecsByIntent.set(intent, p.subspecs);
const composed: number[] = [];
let fullyPlanned = 0;
for (const s of splits) {
  const counts = s.intents.map((i) => subspecsByIntent.get(i));
  if (counts.every((c) => c !== undefined)) {
    fullyPlanned += 1;
    composed.push(counts.reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0);
  }
}
console.log(`splits fully planned downstream: ${fullyPlanned}/${splits.length}`);
console.log(`subspecs per seed (fully planned only): ${stats(composed)}`);
console.log(`histogram: ${histogram(composed)}`);
