import { randomInt } from 'node:crypto';
export const LADDER_WORDS = 4;

function ladderNeighbors(words: string[]) {
  const buckets = new Map<string, string[]>();
  for (const word of words) {
    for (let i = 0; i < word.length; i++) {
      const pattern = word.slice(0, i) + '*' + word.slice(i + 1);
      const bucket = buckets.get(pattern) ?? [];
      bucket.push(word);
      buckets.set(pattern, bucket);
    }
  }
  return (word: string) => [...new Set([...word].flatMap((_, i) => buckets.get(word.slice(0, i) + '*' + word.slice(i + 1)) ?? []))];
}

function findChain(neighbors: ReturnType<typeof ladderNeighbors>, word: string, visited: Set<string>, remaining: number): string[] | undefined {
  if (!remaining) return [];
  for (const next of neighbors(word)) {
    if (visited.has(next)) continue;
    visited.add(next);
    const rest = findChain(neighbors, next, visited, remaining - 1);
    visited.delete(next);
    if (rest) return [next, ...rest];
  }
  return undefined;
}

export function nextLadderWord(words: string[], used: string[], remaining: number) {
  const neighbors = ladderNeighbors(words);
  const previous = used.at(-1)!;
  const visited = new Set(used);
  return findChain(neighbors, previous, visited, remaining)?.[0]
    ?? neighbors(previous).find(word => !visited.has(word));
}

// Offer only starting words with a chain of four distinct common words.
export function createLadder(words: string[]) {
  if (!words.length) return undefined;
  const neighbors = ladderNeighbors(words);
  const offset = randomInt(words.length);
  for (let attempt = 0; attempt < words.length; attempt++) {
    const startWord = words[(offset + attempt) % words.length]!;
    if (findChain(neighbors, startWord, new Set([startWord]), LADDER_WORDS)) return { startWord };
  }
  return undefined;
}
