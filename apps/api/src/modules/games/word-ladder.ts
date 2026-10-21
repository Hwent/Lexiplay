import { randomInt } from 'node:crypto';
export const LADDER_WORDS = 4;

// Offer only starting words with a chain of four distinct common words.
export function createLadder(words: string[]) {
  const buckets = new Map<string, string[]>();
  for (const word of words) {
    for (let i = 0; i < word.length; i++) {
      const pattern = word.slice(0, i) + '*' + word.slice(i + 1);
      const bucket = buckets.get(pattern) ?? [];
      bucket.push(word);
      buckets.set(pattern, bucket);
    }
  }
  if (!words.length) return undefined;
  const offset = randomInt(words.length);
  for (let attempt = 0; attempt < words.length; attempt++) {
    const startWord = words[(offset + attempt) % words.length]!;
    const visited = new Set([startWord]);
    function hasChain(word: string, remaining: number): boolean {
      if (!remaining) return true;
      for (let i = 0; i < word.length; i++) {
        for (const next of buckets.get(word.slice(0, i) + '*' + word.slice(i + 1)) ?? []) {
          if (visited.has(next)) continue;
          visited.add(next);
          if (hasChain(next, remaining - 1)) return true;
          visited.delete(next);
        }
      }
      return false;
    }
    if (hasChain(startWord, LADDER_WORDS)) return { startWord };
  }
  return undefined;
}
