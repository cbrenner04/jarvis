import { describe, expect, test } from "bun:test";
import { locateDiscoveredFile, locateSymbolSlice } from "../../../shared/structural-test-locator.ts";

type ModuleSet = Readonly<Record<string, string>>;

const OWNER_PATH = "v2/src/commands/fixture-owner.ts";
const SIBLING_PATH = "v2/src/commands/fixture-sibling.ts";
const CONSUMER_PATH = "v2/src/commands/fixture-consumer.ts";
const GUARDED_CALL_PATTERN = /prepareGuardedCall\s*\(/;
const OWNER_SYMBOL_START = "export function prepareGuardedCall";
const OWNER_SYMBOL_END = "export function otherOwnerHelper";

/** Pre-fix path allowlist: skips allowed modules and never asserts owner presence. */
function pathPinnedAbsenceOnlyGuard(
  modules: ModuleSet,
  callPattern: RegExp,
  allowedPaths: ReadonlySet<string>,
): boolean {
  for (const [path, source] of Object.entries(modules)) {
    if (allowedPaths.has(path)) continue;
    if (callPattern.test(source)) return false;
  }
  return true;
}

type SymbolResolvedMoveGuardOptions = {
  ownerPath: string;
  adapterPaths: readonly string[];
  callPattern: RegExp;
  ownerSymbolStart: string;
  ownerSymbolEnd: string;
};

const MOVE_GUARD_OPTIONS: SymbolResolvedMoveGuardOptions = {
  ownerPath: OWNER_PATH,
  adapterPaths: [CONSUMER_PATH],
  callPattern: GUARDED_CALL_PATTERN,
  ownerSymbolStart: OWNER_SYMBOL_START,
  ownerSymbolEnd: OWNER_SYMBOL_END,
};

/** Post-fix move guard: absence outside owner/adapters plus presence inside owner export slice. */
export function symbolResolvedMoveGuard(modules: ModuleSet, options: SymbolResolvedMoveGuardOptions): boolean {
  for (const [path, source] of Object.entries(modules)) {
    if (path === options.ownerPath || options.adapterPaths.includes(path)) continue;
    if (options.callPattern.test(source)) return false;
  }

  const ownerSource = locateDiscoveredFile(modules, options.ownerPath);
  const ownerSlice = locateSymbolSlice({
    candidates: [ownerSource],
    start: options.ownerSymbolStart,
    end: options.ownerSymbolEnd,
  });
  if (!options.callPattern.test(ownerSlice)) return false;
  return true;
}

function modulesWithSymbolInOwner(): ModuleSet {
  return {
    [OWNER_PATH]: [
      "export function prepareGuardedCall() {",
      "  return 'owner';",
      "}",
      "export function otherOwnerHelper() {}",
    ].join("\n"),
    [SIBLING_PATH]: "export function unrelatedSiblingHelper() {}\n",
    [CONSUMER_PATH]: 'import { prepareGuardedCall } from "./fixture-owner.ts";\n',
  };
}

function modulesWithSymbolMovedToSibling(): ModuleSet {
  return {
    [OWNER_PATH]: "export function otherOwnerHelper() {}\n",
    [SIBLING_PATH]: ["export function prepareGuardedCall() {", "  return 'sibling';", "}"].join("\n"),
    [CONSUMER_PATH]: 'import { prepareGuardedCall } from "./fixture-sibling.ts";\n',
  };
}

describe("structural invariant move regression", () => {
  test("re-keyed move guard fails on fixed path allowlist and passes when symbol moves to sibling module", () => {
    const inOwner = modulesWithSymbolInOwner();
    const ownerOnlyAllowlist = new Set([OWNER_PATH]);
    expect(pathPinnedAbsenceOnlyGuard(inOwner, GUARDED_CALL_PATTERN, ownerOnlyAllowlist)).toBe(true);
    expect(symbolResolvedMoveGuard(inOwner, MOVE_GUARD_OPTIONS)).toBe(true);

    const movedToSibling = modulesWithSymbolMovedToSibling();
    const brittleAllowlist = new Set([OWNER_PATH, SIBLING_PATH]);
    expect(pathPinnedAbsenceOnlyGuard(movedToSibling, GUARDED_CALL_PATTERN, brittleAllowlist)).toBe(true);
    expect(symbolResolvedMoveGuard(movedToSibling, MOVE_GUARD_OPTIONS)).toBe(false);
  });
});
