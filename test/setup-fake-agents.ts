// Test preload: guarantees the suite never spawns a real agent CLI.
//
// Several end-to-end code paths spawn an agent by its bare binary name
// (`claude`/`codex`/`cursor`/...) via the real factory. Under tests that would
// invoke the actual CLI, making live API calls and triggering network
// permission prompts. We prepend a temp dir of no-op fakes (exit 0) onto PATH so
// those bare-name spawns resolve to the fakes instead.
//
// Tests that inject an explicit absolute `binary:` path bypass PATH and are
// unaffected; tests asserting "binary not found" use a bare name we do not stub
// (e.g. "fake"), so they still get ENOENT.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const binDir = mkdtempSync(join(tmpdir(), "jarvis-test-fake-agents-"));
for (const name of ["claude", "codex", "cursor", "aider", "opencode"]) {
  const bin = join(binDir, name);
  writeFileSync(bin, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(bin, 0o755);
}
process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
