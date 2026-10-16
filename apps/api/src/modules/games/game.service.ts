import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { WordListsService } from '../word-lists/word-lists.service';
import { defaultAnswerWords } from '../word-lists/default-answers';
import { GameRepository } from './game.repository';
import { DIFFICULTIES, Difficulty, Game, Guess, HintType, HINT_COST, publicGame, WORDLE_COST, score } from './game.types';

@Injectable()
export class GameService {
  constructor(@Inject(WordListsService) private readonly dictionary: WordListsService, @Inject(GameRepository) private readonly games: GameRepository) {}

  async start(wordLength: number = 5, wordList: string[] | undefined, difficulty: Difficulty = 'medium', owner: string, selectedPool?: { id: string; name: string; author: string }, startRequestId: string = randomUUID()) {
    if (!Number.isInteger(wordLength) || wordLength < 3 || wordLength > 9) throw new BadRequestException({ code: 'INVALID_WORD_LENGTH', message: 'Choose a word length from three to nine letters.' });
    if (!Object.hasOwn(DIFFICULTIES, difficulty)) throw new BadRequestException('Choose a valid difficulty.');
    const rules = DIFFICULTIES[difficulty];
    const allowedWords = await this.dictionary.dictionaryGameWords(wordLength);
    if (!allowedWords.length) throw new ServiceUnavailableException({ code: 'DICTIONARY_NOT_READY', message: `The dictionary has no ${wordLength}-letter game words. Load the dictionary before playing.` });
    let answers = defaultAnswerWords(wordLength, allowedWords);
    if (wordList !== undefined) {
      const pool = new Set(allowedWords);
      answers = [...new Set(wordList)].filter(word => pool.has(word));
    }
    if (!answers.length) {
      if (wordList === undefined) throw new ServiceUnavailableException({ code: 'NO_PLAYABLE_ANSWERS', message: `No ${wordLength}-letter answers are available in this pool yet.` });
      throw new BadRequestException({ code: 'NO_PLAYABLE_WORDS', message: `Your word list has no ${wordLength}-letter words in the game dictionary yet.` });
    }
    const game: Game = {
      id: randomUUID(), startRequestId, kind: 'word-puzzle', owner, ...(selectedPool ? { pool: selectedPool } : {}), answer: answers[randomInt(answers.length)]!,
      wordLength, difficulty, attemptLimit: rules.attemptLimit, guesses: [], completed: false,
      startedAt: new Date().toISOString(), completedAt: null,
      hints: { synonym: 1, definition: 1 }, clues: {}, hintCoinsSpent: 0, revealedAbsent: [], revealedPresent: [],
      status: 'active', coinCost: WORDLE_COST, winRewardCoins: rules.reward, coinPayer: owner.startsWith('user:') ? 'account' : 'guest',
    };
    return publicGame(await this.games.create(game));
  }

  async read(id: string, owner: string) { return publicGame(await this.games.read(id, owner)); }

  async hint(id: string, type: HintType, owner: string) {
    const current = await this.games.read(id, owner);
    this.requireActive(current);
    // Resolve online clues before taking wallet and game locks.
    const text = current.clues[type] ?? (type === 'synonym'
      ? await this.dictionary.dictionarySynonym(current.answer)
      : current.answerDefinition || await this.dictionary.dictionaryDefinition(current.answer));
    if (!text) throw new BadRequestException({ code: 'NO_HINT_AVAILABLE', message: `No ${type} is available for this word. No coins were charged.` });
    const clue = text.replace(new RegExp(`\\b${current.answer}\\b`, 'gi'), '_____');
    return this.games.change(id, owner, game => {
      this.requireActive(game);
      const purchased = !!game.clues[type];
      if (!purchased) {
        game.clues[type] = clue;
        game.hints[type] = 0;
        game.hintCoinsSpent += HINT_COST;
      }
      return { type, text: game.clues[type]!, hints: { ...game.hints }, cost: purchased ? 0 : HINT_COST };
    });
  }

  async submit(id: string, rawGuess: string, owner: string): Promise<Guess> {
    return this.games.change(id, owner, async game => {
      this.requireActive(game);
      const guess = rawGuess.trim().toLowerCase();
      if (!/^[a-z]+$/.test(guess) || guess.length !== game.wordLength || !(await this.dictionary.isDictionaryGameWord(guess))) throw new BadRequestException({ code: 'INVALID_GUESS', message: `Enter a valid ${game.wordLength}-letter word from the practice dictionary.` });
      const attemptsRemaining = game.attemptLimit - game.guesses.length - 1;
      const won = guess === game.answer;
      const completed = won || attemptsRemaining === 0;
      const result: Guess = { guess, feedback: score(game.answer, guess), attemptsRemaining, completed };
      result.definition = await this.dictionary.dictionaryDefinition(guess) ?? '';
      if (completed) {
        result.outcome = won ? 'WON' : 'LOST';
        result.answer = game.answer;
        result.answerDefinition = won ? result.definition : await this.dictionary.dictionaryDefinition(game.answer) ?? '';
        game.completed = true;
        game.status = won ? 'won' : 'lost';
        if (won) result.rewardCoins = game.winRewardCoins;
        game.completedAt = new Date().toISOString();
      }
      game.guesses.push(result);
      return result;
    });
  }

  async abandon(id: string, owner: string) {
    return this.games.change(id,owner,game => {
      if (!game.completed) { game.completed=true; game.status='cancelled'; game.completedAt=new Date().toISOString(); }
      return { success:true };
    });
  }

  private requireActive(game: Game) {
    if (game.completed) throw new BadRequestException({ code: 'GAME_FINISHED', message: 'This game is already complete.' });
  }
}

export { score } from './game.types';
