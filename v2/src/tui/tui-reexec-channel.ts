import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
/** Selection/expansion state carried over from a re-exec'd parent, restored as the child's initial state. */
export type TuiReexecCarriedState = {
  selectedNodeId: string | null;
  expandedPipelineNodeIds: readonly string[];
};

/** Reserved worker exit code requesting supervisor respawn onto current code. */
export const TUI_REVISION_REEXEC_EXIT_CODE = 6;

/** Env var holding the filesystem path of the supervisor-owned re-exec channel file. */
export const TUI_REEXEC_CHANNEL_ENV = "JARVIS_TUI_REEXEC_CHANNEL";

export type TuiRevisionReexecChannelPayload = {
  daemonRevision: string;
  carriedState: TuiReexecCarriedState;
};

export type TuiRevisionReexecChannel = {
  publish(payload: TuiRevisionReexecChannelPayload): void;
  take(): TuiRevisionReexecChannelPayload | undefined;
};

export function createInMemoryTuiRevisionReexecChannel(): TuiRevisionReexecChannel {
  let stored: TuiRevisionReexecChannelPayload | undefined;
  return {
    publish(payload) {
      stored = payload;
    },
    take() {
      const payload = stored;
      stored = undefined;
      return payload;
    },
  };
}

export function createFileTuiRevisionReexecChannel(filePath: string): TuiRevisionReexecChannel {
  return {
    publish(payload) {
      writeFileSync(filePath, JSON.stringify(payload), "utf8");
    },
    take() {
      if (!existsSync(filePath)) return undefined;
      const raw = readFileSync(filePath, "utf8");
      unlinkSync(filePath);
      return JSON.parse(raw) as TuiRevisionReexecChannelPayload;
    },
  };
}

export function tuiRevisionReexecChannelFromEnv(env: NodeJS.ProcessEnv): TuiRevisionReexecChannel {
  const filePath = env[TUI_REEXEC_CHANNEL_ENV];
  if (filePath === undefined) {
    return {
      publish() {},
      take() {
        return undefined;
      },
    };
  }
  return createFileTuiRevisionReexecChannel(filePath);
}
