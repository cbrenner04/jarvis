import { verifyMutationCheckpoints } from "./v2/src/execution/mutation-checkpoint-verifier.ts";

const spec = process.argv[2];
const r = await verifyMutationCheckpoints(process.cwd(), spec, {});
console.log("caught:", r.caught.length, "hollow:", r.hollow.length, "unparseable:", r.unparseable.length);
for (const h of r.hollow) console.log("  HOLLOW:", (h.criterionText || h.detail || JSON.stringify(h)).slice(0, 120));
for (const u of r.unparseable) console.log("  UNPARSEABLE:", JSON.stringify(u).slice(0, 160));
