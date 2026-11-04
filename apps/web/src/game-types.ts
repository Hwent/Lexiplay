import type { Ladder } from './WordLadderBoard';
export type Feedback = 'CORRECT' | 'PRESENT' | 'ABSENT';
export type GameWallet = { coinBalance: number; kind: 'account' | 'guest' };
export type GuessResult = {
  guess: string;
  feedback: Feedback[];
  attemptsRemaining: number;
  completed: boolean;
  outcome?: 'WON' | 'LOST';
  answer?: string;
  definition?: string;
  answerDefinition?: string;
  rewardCoins?: number;
  wallet?: GameWallet;
};
export type HintType = 'definition' | 'nextWord';
export type Game = { wallet?: GameWallet; kind?: 'word-puzzle' | 'word-ladder'; ladder?: Ladder; answer?: string; answerDefinition?: string; completed?: boolean; attemptCount?: number; coinChange?: number; pool?: { id: string; name: string; author: string }; id: string; wordLength: number; difficulty?: string; attemptLimit: number; guesses: GuessResult[]; hints: { definition: number; nextWord?: number }; clues?: Partial<Record<HintType, string>>; hintCoinsSpent?: number; revealedAbsent: string[]; revealedPresent: string[]; status?: string; cancellationReason?: string; coinCost?: number; winRewardCoins?: number; coinPayer?: 'account' | 'guest' };
