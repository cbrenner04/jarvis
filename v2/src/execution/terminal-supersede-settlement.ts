export const TERMINAL_SUPERSEDE_SETTLEMENT_COMMENT_BODY_RE =
  /^Superseded by #(\d+) \(pipeline ([^,]+), stage ([^)]+)\)$/;

export function formatTerminalSupersedeSettlementComment(args: {
  terminalPrNumber: number;
  pipelineId: string;
  stageId: string;
}): string {
  return `Superseded by #${args.terminalPrNumber} (pipeline ${args.pipelineId}, stage ${args.stageId})`;
}

export function parseTerminalSupersedeSettlementSuccessorPrNumber(commentBody: string): number | undefined {
  const match = TERMINAL_SUPERSEDE_SETTLEMENT_COMMENT_BODY_RE.exec(commentBody);
  if (match === null) return undefined;
  const successorPrNumber = Number(match[1]);
  if (!Number.isInteger(successorPrNumber) || successorPrNumber <= 0) return undefined;
  return successorPrNumber;
}
