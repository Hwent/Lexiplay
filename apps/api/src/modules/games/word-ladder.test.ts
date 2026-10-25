import { describe, expect, it } from 'vitest';
import { createLadder, nextLadderWord } from './word-ladder';

describe('word ladders', () => {
  it('suggests a fresh one-letter step that leaves a complete chain when possible', () => {
    const words = ['bold', 'cold', 'cord', 'card', 'ward', 'warm'];
    expect(nextLadderWord(words, ['cold'], 4)).toBe('cord');
    expect(nextLadderWord(words, ['cold', 'cord'], 3)).toBe('card');
    expect(nextLadderWord(words, ['cold', 'cord', 'card', 'ward'], 1)).toBe('warm');
    expect(nextLadderWord(words, ['cold', 'cord', 'card', 'ward', 'warm'], 1)).toBeUndefined();
    expect(nextLadderWord(['cold', 'cord'], ['cold'], 4)).toBe('cord');
  });
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
