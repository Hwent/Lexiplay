export type Feedback = 'CORRECT' | 'PRESENT' | 'ABSENT';
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES = {
  easy: { attemptLimit: 7, hints: 3 },
  medium: { attemptLimit: 6, hints: 2 },
  hard: { attemptLimit: 5, hints: 1 },
} as const;
export type Guess = {
  guess: string; feedback: Feedback[]; attemptsRemaining: number; completed: boolean;
  outcome?: 'WON' | 'LOST'; answer?: string; definition?: string; answerDefinition?: string;
};
export type Game = {
  pool?: { id: string; name: string; author: string };
  id: string; kind: 'word-puzzle'; owner: string; answer: string; allowedWords: string[];
  wordLength: number; difficulty: Difficulty; attemptLimit: number; guesses: Guess[];
  completed: boolean; startedAt: string; completedAt: string | null;
  hints: { unused: number; present: number }; revealedAbsent: string[]; revealedPresent: string[];
};
export function publicGame(game: Game) {
  const { owner: _owner, answer: _answer, allowedWords: _words, ...result } = game;
  return result;
}
