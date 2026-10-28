export type Feedback = 'CORRECT' | 'PRESENT' | 'ABSENT';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type GameStatus = 'active' | 'won' | 'lost' | 'cancelled';
export const WORDLE_COST = 1;
export const HINT_COST = 1;
export const PUZZLE_ALREADY_STARTED = { code: 'PUZZLE_ALREADY_STARTED', message: 'Finish this puzzle or give up before choosing a new one.' };
export type HintType = 'definition' | 'nextWord';
export const WORD_PUZZLE_ATTEMPTS = 6;
// Existing rounds retain their original attempt limit when restored.
export const LEGACY_ATTEMPT_LIMITS = { easy: 7, medium: WORD_PUZZLE_ATTEMPTS, hard: 5 } as const;
export function wordPuzzleReward(wordLength: number): number { return Math.ceil(wordLength / 2) + 2; }
export type Guess = {
  guess: string; feedback: Feedback[]; attemptsRemaining: number; completed: boolean;
  outcome?: 'WON' | 'LOST'; answer?: string; definition?: string; answerDefinition?: string; rewardCoins?: number;
};
export type Game = {
  pool?: { id: string; name: string; author: string };
  id: string; startRequestId: string; kind: 'word-puzzle' | 'word-ladder'; owner: string; answer: string;
  ladder?: { startWord: string; targetWords: number; startDefinition?: string };
  wordLength: number; difficulty: Difficulty; attemptLimit: number; guesses: Guess[];
  completed: boolean; status: GameStatus; startedAt: string; completedAt: string | null;
  hints: { definition: number; nextWord?: number }; clues: Partial<Record<HintType, string>>; hintCoinsSpent: number;
  revealedAbsent: string[]; revealedPresent: string[];
  coinCost: number; winRewardCoins: number; coinPayer: 'account' | 'guest';
  attemptCount?: number; coinChange?: number; answerDefinition?: string;
  cancellationReason?: string;
};
export function publicGame(game: Game) {
  const { owner: _owner, answer: _answer, answerDefinition: _definition, startRequestId: _request, ...result } = game;
  return { ...result,
    ...(game.completed ? { answer: game.answer, answerDefinition: game.answerDefinition } : {}) };
}

export function score(answer: string, guess: string): Feedback[] {
  const feedback: Feedback[] = Array.from({ length: answer.length }, () => 'ABSENT');
  const remaining = new Map<string, number>();
  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) feedback[i] = 'CORRECT';
    else remaining.set(answer[i]!, (remaining.get(answer[i]!) ?? 0) + 1);
  }
  for (let i = 0; i < guess.length; i++) {
    if (feedback[i] === 'CORRECT') continue;
    const count = remaining.get(guess[i]!) ?? 0;
    if (count > 0) { feedback[i] = 'PRESENT'; remaining.set(guess[i]!, count - 1); }
  }
  return feedback;
}
