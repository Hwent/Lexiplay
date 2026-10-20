import { describe, expect, it } from 'vitest';
import { createLadder, ladderFeedback } from './word-ladder';

describe('word ladders', () => {
  it('offers a reachable pair with at least three substitutions', () => {
    const words = ['cold', 'cord', 'card', 'ward', 'warm', 'solo'];
    for (let i = 0; i < 20; i++) {
      const ladder = createLadder(words)!;
      expect(ladder).toBeDefined();
      expect(ladder.startWord).not.toBe('solo');
      expect(ladder.goalWord).not.toBe('solo');
      expect(ladder.shortestSteps).toBe(Math.abs(words.indexOf(ladder.startWord) - words.indexOf(ladder.goalWord)));
      expect(ladder.shortestSteps).toBeGreaterThanOrEqual(3);
    }
  });
  it('does not offer disconnected or trivial puzzles', () => {
    expect(createLadder([])).toBeUndefined();
    expect(createLadder(['cold', 'warm', 'solo'])).toBeUndefined();
    expect(createLadder(['cold', 'cord'])).toBeUndefined();
  });
  it('highlights the changed position, including repeated letters', () => {
    expect(ladderFeedback('still', 'stall')).toEqual(['ABSENT', 'ABSENT', 'CORRECT', 'ABSENT', 'ABSENT']);
  });
});
