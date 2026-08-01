export function gateA(value: number): boolean {
  // Mutation checkpoint: negating gate A `!value` guard must turn pin RED.
  if (!value) return false;
  return true;
}
