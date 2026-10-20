import { describe, expect, it } from 'vitest';
import { createLadder, ladderFeedback, shortestLadderSteps } from './word-ladder';

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
  it('colors changed letters by their exact position in the goal', () => {
    expect(ladderFeedback('still', 'stall', 'stale')).toEqual(['CORRECT', 'CORRECT', 'CORRECT', 'CORRECT', 'ABSENT']);
    expect(ladderFeedback('cold', 'gold', 'warm')).toEqual(['PRESENT', 'ABSENT', 'ABSENT', 'ABSENT']);
    expect(ladderFeedback('cold', 'cord', 'warm')).toEqual(['ABSENT', 'ABSENT', 'CORRECT', 'ABSENT']);
    expect(ladderFeedback('cord', 'card', 'warm')).toEqual(['ABSENT', 'CORRECT', 'CORRECT', 'ABSENT']);
    expect(ladderFeedback('ward', 'warm', 'warm')).toEqual(['CORRECT', 'CORRECT', 'CORRECT', 'CORRECT']);
  });
  it('finds the shortest route across the full accepted dictionary', () => {
    expect(shortestLadderSteps(['cat','cot','cog','dog','dot'], 'cat', 'dog')).toBe(3);
    expect(shortestLadderSteps(['cat','cot','cog','dog','dot','dat'], 'cat', 'dot')).toBe(2);
    expect(shortestLadderSteps(['cold','warm'], 'cold', 'warm')).toBeUndefined();
  });
});
