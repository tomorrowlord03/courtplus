export function* contextualRoleInputs(
  tokens: readonly number[][],
  length: number,
  special: { cls: number; sep: number },
): Iterable<number[]> {
  const budget = length - 4;
  if (!Number.isInteger(budget) || budget < 0) throw new Error('Invalid local role model window.');
  const { cls, sep } = special;
  for (const [i, target] of tokens.entries()) {
    const previous = tokens[i - 1] ?? [];
    const following = tokens[i + 1] ?? [];
    const sideLimit = Math.max(Math.floor(budget / 4), Math.floor((budget - target.length) / 2));
    const left = previous.slice(Math.max(0, previous.length - sideLimit));
    const right = following.slice(0, sideLimit);
    const center = target.slice(0, budget - left.length - right.length);
    yield [cls, ...left, sep, ...center, sep, ...right, sep];
  }
}
