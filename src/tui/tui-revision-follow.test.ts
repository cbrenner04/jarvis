import { describe, expect, test } from "bun:test";
import { type DaemonRevisionReadOutcome, decideTuiRevisionReexec } from "./tui-revision-follow.ts";

const success = (loadedRevision: string | undefined): DaemonRevisionReadOutcome => ({
  kind: "success",
  loadedRevision,
});
const failure: DaemonRevisionReadOutcome = { kind: "failure" };

const STABLE_DIFFERING = { previousRead: success("rev-b"), currentRead: success("rev-b") };

describe("decideTuiRevisionReexec", () => {
  test("re-execs on a stable differing revision with no dock input, no pending dispatch, no marker", () => {
    const decision = decideTuiRevisionReexec(
      "rev-a",
      STABLE_DIFFERING.previousRead,
      STABLE_DIFFERING.currentRead,
      true,
      false,
      undefined,
    );
    expect(decision).toEqual({ reexec: true, daemonRevision: "rev-b" });
  });

  test("no re-exec when the monitor and daemon revisions match", () => {
    const decision = decideTuiRevisionReexec("rev-a", success("rev-a"), success("rev-a"), true, false, undefined);
    expect(decision).toEqual({ reexec: false });
  });

  test("no re-exec when the daemon revision is unknown on both reads", () => {
    const decision = decideTuiRevisionReexec("rev-a", success("unknown"), success("unknown"), true, false, undefined);
    expect(decision).toEqual({ reexec: false });
  });

  test("no re-exec when the daemon revision is absent on both reads", () => {
    const decision = decideTuiRevisionReexec("rev-a", success(undefined), success(undefined), true, false, undefined);
    expect(decision).toEqual({ reexec: false });
  });

  test("no re-exec when the monitor's own revision is unknown", () => {
    const decision = decideTuiRevisionReexec(
      "unknown",
      STABLE_DIFFERING.previousRead,
      STABLE_DIFFERING.currentRead,
      true,
      false,
      undefined,
    );
    expect(decision).toEqual({ reexec: false });
  });

  test("no re-exec on a single differing read (no prior read yet, i.e. at connect)", () => {
    const decision = decideTuiRevisionReexec("rev-a", undefined, success("rev-b"), true, false, undefined);
    expect(decision).toEqual({ reexec: false });
  });

  test("no re-exec when consecutive reads differ from each other", () => {
    const decision = decideTuiRevisionReexec("rev-a", success("rev-b"), success("rev-c"), true, false, undefined);
    expect(decision).toEqual({ reexec: false });
  });

  test("no re-exec on a failed read", () => {
    const decision = decideTuiRevisionReexec("rev-a", success("rev-b"), failure, true, false, undefined);
    expect(decision).toEqual({ reexec: false });
  });

  test("no re-exec when the dock input is non-empty", () => {
    const decision = decideTuiRevisionReexec(
      "rev-a",
      STABLE_DIFFERING.previousRead,
      STABLE_DIFFERING.currentRead,
      false,
      false,
      undefined,
    );
    expect(decision).toEqual({ reexec: false });
  });

  test("no re-exec when a command dispatch is pending", () => {
    const decision = decideTuiRevisionReexec(
      "rev-a",
      STABLE_DIFFERING.previousRead,
      STABLE_DIFFERING.currentRead,
      true,
      true,
      undefined,
    );
    expect(decision).toEqual({ reexec: false });
  });

  test("no re-exec when already re-exec'd for the matching daemon revision", () => {
    const decision = decideTuiRevisionReexec(
      "rev-a",
      STABLE_DIFFERING.previousRead,
      STABLE_DIFFERING.currentRead,
      true,
      false,
      "rev-b",
    );
    expect(decision).toEqual({ reexec: false });
  });

  test("once-per-revision guard: no re-exec again while the daemon still reports the marked revision", () => {
    // Own revision still differs ("rev-a" vs "rev-b"), but this process already re-exec'd for rev-b.
    // Without the guard (reexecedForRevision comparison dropped/inverted) this would fire again.
    const decision = decideTuiRevisionReexec("rev-a", success("rev-b"), success("rev-b"), true, false, "rev-b");
    expect(decision).toEqual({ reexec: false });
  });

  test("once-per-revision guard: re-execs once the daemon reports a different stable revision", () => {
    const decision = decideTuiRevisionReexec("rev-a", success("rev-c"), success("rev-c"), true, false, "rev-b");
    expect(decision).toEqual({ reexec: true, daemonRevision: "rev-c" });
  });
});
