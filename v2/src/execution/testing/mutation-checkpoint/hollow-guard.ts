export function keepPositive(value: number): boolean {
  // Mutation checkpoint: negating `!value` guard must turn pin RED.
  if (!value) return false;
  return true;
}
