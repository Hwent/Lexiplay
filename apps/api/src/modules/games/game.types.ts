export type Feedback = 'CORRECT' | 'PRESENT' | 'ABSENT';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type GameStatus = 'active' | 'won' | 'lost' | 'cancelled';
export const WORDLE_COST = 1;
export const DIFFICULTIES = {
  easy: { attemptLimit: 7, hints: 3, reward: 4 },
  medium: { attemptLimit: 6, hints: 2, reward: 5 },
  hard: { attemptLimit: 5, hints: 1, reward: 6 },
} as const;
export type Guess = {
  guess: string; feedback: Feedback[]; attemptsRemaining: number; completed: boolean;
  outcome?: 'WON' | 'LOST'; answer?: string; definition?: string; answerDefinition?: string; rewardCoins?: number;
};
export type Game = {
  pool?: { id: string; name: string; author: string };
  id: string; startRequestId: string; kind: 'word-puzzle'; owner: string; answer: string;
  wordLength: number; difficulty: Difficulty; attemptLimit: number; guesses: Guess[];
  completed: boolean; status: GameStatus; startedAt: string; completedAt: string | null;
  hints: { unused: number; present: number }; revealedAbsent: string[]; revealedPresent: string[];
  coinCost: number; winRewardCoins: number; coinPayer: 'account' | 'guest';
  cancellationReason?: string;
};
export function publicGame(game: Game) {
  const { owner: _owner, answer: _answer, startRequestId: _request, ...result } = game;
  return result;
}
