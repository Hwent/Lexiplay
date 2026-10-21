import { describe, expect, it } from 'vitest';
import { createLadder } from './word-ladder';

describe('word ladders', () => {
  it('offers a start with four distinct one-letter substitutions', () => {
    const words = ['cold', 'cord', 'card', 'ward', 'warm', 'solo'];
    function hasPath(path: string[]): boolean {
      if (path.length === 5) return true;
      return words.some(next => !path.includes(next)
        && [...next].filter((letter, index) => letter !== path.at(-1)![index]).length === 1
        && hasPath([...path, next]));
    }
    for (let i = 0; i < 20; i++) {
      const ladder = createLadder(words)!;
      expect(ladder).toBeDefined();
      expect(hasPath([ladder.startWord])).toBe(true);
      expect(ladder).not.toHaveProperty('goalWord');
    }
  });
  it('rejects pools without four new words, even when words can be revisited', () => {
    expect(createLadder([])).toBeUndefined();
    expect(createLadder(['cold', 'warm', 'solo'])).toBeUndefined();
    expect(createLadder(['cold', 'cord', 'card', 'ward'])).toBeUndefined();
    expect(createLadder(['cold', 'cord', 'cold', 'cord', 'cold'])).toBeUndefined();
  });
});
