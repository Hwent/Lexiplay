import { randomInt } from 'node:crypto';
import type { Feedback } from './game.types';

export function ladderFeedback(previous: string, next: string, goal: string): Feedback[] {
  return [...next].map((letter, index) => letter === previous[index] ? 'ABSENT' : letter === goal[index] ? 'CORRECT' : 'PRESENT');
}

export function shortestLadderSteps(words: string[], start: string, goal: string) {
  const allowed = new Set(words), queue = [{ word: start, steps: 0 }];
  allowed.delete(start);
  for (let head = 0; head < queue.length; head++) {
    const { word, steps } = queue[head]!;
    if (word === goal) return steps;
    for (let index = 0; index < word.length; index++) {
      for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
        const next = word.slice(0, index) + letter + word.slice(index + 1);
        if (!allowed.delete(next)) continue;
        queue.push({ word: next, steps: steps + 1 });
      }
    }
  }
  return undefined;
}

// Search only connected, common words so every offered ladder can be solved.
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
    const distances = new Map([[startWord, 0]]);
    const queue = [startWord];
    const goals: string[] = [];
    for (let head = 0; head < queue.length; head++) {
      const word = queue[head]!, distance = distances.get(word)!;
      if (distance >= 3) goals.push(word);
      if (distance === 6) continue;
      for (let i = 0; i < word.length; i++) {
        for (const next of buckets.get(word.slice(0, i) + '*' + word.slice(i + 1)) ?? []) {
          if (distances.has(next)) continue;
          distances.set(next, distance + 1);
          queue.push(next);
        }
      }
    }
    if (goals.length) {
      const goalWord = goals[randomInt(goals.length)]!;
      return { startWord, goalWord, shortestSteps: distances.get(goalWord)! };
    }
  }
  return undefined;
}
