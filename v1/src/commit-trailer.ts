export function appendAgentTrailer(message: string, agentLabel: string): string {
  if (agentLabel === "") {
    return message;
  }
  const trimmed = message.replace(/\n+$/, "");
  return `${trimmed}\n\nJarvis-Agent: ${agentLabel}`;
}
