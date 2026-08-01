export function gateB(value: number): boolean {
  // Mutation checkpoint: negating gate B `!value` guard must turn pin RED.
  if (!value) return false;
  return true;
}
