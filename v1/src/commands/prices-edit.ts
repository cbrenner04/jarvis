import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Io } from "../cli.ts";
import { loadPrices } from "../prices/load.ts";

export type PricesEditCommandOptions = {
  io: Io;
  editor?: string;
  runEditor?: ((file: string) => number) | undefined;
};

function getPricesPath(): string {
  return join(import.meta.dir, "..", "..", "data", "prices.json");
}

function hashFile(filePath: string): string {
  const content = readFileSync(filePath, "utf8");
  return createHash("sha256").update(content).digest("hex");
}

function resolveEditor(): string {
  const env = process.env as Record<string, string | undefined>;
  return env.EDITOR || env.VISUAL || "vi";
}

export function pricesEditCommand(opts: PricesEditCommandOptions): number {
  const { io } = opts;

  const pricesPath = getPricesPath();

  // Validate that the file is currently readable/loadable
  try {
    loadPrices(pricesPath);
  } catch (err) {
    io.stderr(`jarvis: ${(err as Error).message}\n`);
    return 1;
  }

  // Get editor and file hash before editing
  const editor = opts.editor ?? resolveEditor();
  const originalHash = hashFile(pricesPath);

  // Launch editor
  io.stderr(`opening v1/data/prices.json in $EDITOR ...\n`);

  let status: number;
  if (opts.runEditor !== undefined) {
    status = opts.runEditor(pricesPath);
  } else {
    const result = spawnSync(editor, [pricesPath], {
      stdio: "inherit",
      shell: true,
    });
    status = result.status ?? 1;

    // Check if the editor couldn't be spawned
    if (result.error) {
      io.stderr(
        `jarvis: could not launch ${JSON.stringify(editor)}: ${(result.error as Error).message}\n`,
      );
      io.stderr(`edit ${JSON.stringify(pricesPath)} manually\n`);
      return 1;
    }
  }

  // Handle editor exit non-zero
  if (status !== 0) {
    io.stderr("aborted\n");
    return 1;
  }

  // Check if file was modified
  const newHash = hashFile(pricesPath);
  if (newHash === originalHash) {
    io.stdout("no changes\n");
    return 0;
  }

  // Validate the edited file
  try {
    loadPrices(pricesPath);
  } catch (err) {
    const errorMsg = (err as Error).message;
    io.stderr(`validation failed: ${errorMsg}\n`);
    return 1;
  }

  io.stdout("validated; saved.\n");
  return 0;
}
