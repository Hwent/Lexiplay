import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { WordListsService } from '../word-lists/word-lists.service';
import { defaultAnswerWords } from '../word-lists/default-answers';
import { GameRepository } from './game.repository';
import { createLadder, LADDER_WORDS, nextLadderWord } from './word-ladder';
import { LEGACY_ATTEMPT_LIMITS, WORD_PUZZLE_ATTEMPTS, wordPuzzleReward, Difficulty, Game, Guess, HintType, HINT_COST, publicGame, PUZZLE_ALREADY_STARTED, WORDLE_COST, score } from './game.types';

@Injectable()
export class GameService {
  constructor(@Inject(WordListsService) private readonly dictionary: WordListsService, @Inject(GameRepository) private readonly games: GameRepository) {}

  async start(wordLength: number = 5, wordList: string[] | undefined, difficulty: Difficulty = 'medium', owner: string, selectedPool?: { id: string; name: string; author: string }, startRequestId: string = randomUUID()) {
    if (!Number.isInteger(wordLength) || wordLength < 3 || wordLength > 9) throw new BadRequestException({ code: 'INVALID_WORD_LENGTH', message: 'Choose a word length from three to nine letters.' });
    if (!Object.hasOwn(LEGACY_ATTEMPT_LIMITS, difficulty)) throw new BadRequestException('Choose a valid difficulty.');
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
      wordLength, difficulty: 'medium', attemptLimit: WORD_PUZZLE_ATTEMPTS, guesses: [], completed: false,
      startedAt: new Date().toISOString(), completedAt: null,
      hints: { definition: 1 }, clues: {}, hintCoinsSpent: 0, revealedAbsent: [], revealedPresent: [],
      status: 'active', coinCost: WORDLE_COST, winRewardCoins: wordPuzzleReward(wordLength), coinPayer: owner.startsWith('user:') ? 'account' : 'guest',
    };
    return publicGame(await this.games.create(game));
  }

  async read(id: string, owner: string) { return publicGame(await this.games.read(id, owner)); }

  async startLadder(wordLength: number, owner: string, startRequestId: string = randomUUID()) {
    if (![4, 5].includes(wordLength)) throw new BadRequestException('Choose four or five letters for Word Ladder.');
    const words = await this.dictionary.dictionaryGameWords(wordLength);
    const ladder = createLadder(defaultAnswerWords(wordLength, words));
    if (!ladder) throw new ServiceUnavailableException({ code: 'NO_PLAYABLE_LADDER', message: 'No connected word ladder is available at this length yet.' });
    const game: Game = {
      id: randomUUID(), startRequestId, kind: 'word-ladder', owner, answer: ladder.startWord,
      ladder: { startWord: ladder.startWord, targetWords: LADDER_WORDS },
      wordLength, difficulty: 'medium', attemptLimit: LADDER_WORDS, guesses: [], completed: false,
      startedAt: new Date().toISOString(), completedAt: null,
      hints: { definition: 0, nextWord: 1 }, clues: {}, hintCoinsSpent: 0, revealedAbsent: [], revealedPresent: [],
      status: 'active', coinCost: 1, winRewardCoins: wordLength, coinPayer: owner.startsWith('user:') ? 'account' : 'guest',
    };
    return publicGame(await this.games.create(game));
  }

  async hint(id: string, type: HintType, owner: string) {
    const current = await this.games.read(id, owner);
    this.requireActive(current);
    if (type === 'nextWord') {
      if (!current.ladder) throw new BadRequestException('Next-word hints are only available in Word Ladder.');
      const words = await this.dictionary.dictionaryGameWords(current.wordLength);
      return this.games.change(id, owner, game => {
        this.requireActive(game);
        const purchased = !!game.clues.nextWord;
        const used = [game.ladder!.startWord, ...game.guesses.map(step => step.guess)];
        const word = game.clues.nextWord ?? nextLadderWord(words, used, game.attemptLimit - game.guesses.length);
        if (!word) throw new BadRequestException({ code: 'NO_HINT_AVAILABLE', message: 'No next word is available. No coins were charged.' });
        if (!purchased) {
          game.clues.nextWord = word;
          game.hints.nextWord = 0;
          game.hintCoinsSpent += HINT_COST;
        }
        return { type, text: word, hints: { ...game.hints }, cost: purchased ? 0 : HINT_COST };
      });
    }
    if (current.ladder) throw new BadRequestException('Word Ladder already includes word definitions.');
    // Resolve dictionary clues before taking wallet and game locks.
    const text = current.clues[type] ?? (current.answerDefinition || await this.dictionary.dictionaryDefinition(current.answer, true));
    if (!text) throw new BadRequestException({ code: 'NO_HINT_AVAILABLE', message: 'No definition is available for this word. No coins were charged.' });
    const clue = text.replace(new RegExp(current.answer, 'gi'), '_____');
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
      const previous = game.guesses.at(-1)?.guess ?? game.ladder?.startWord;
      if (game.ladder && (guess === game.ladder.startWord || game.guesses.some(step => step.guess === guess))) {
        throw new BadRequestException({ code: 'REPEATED_LADDER_WORD', message: 'Use a different word. The starting word and earlier words cannot be reused.' });
      }
      if (game.ladder && [...guess].filter((letter, index) => letter !== previous![index]).length !== 1) {
        throw new BadRequestException({ code: 'INVALID_LADDER_STEP', message: 'Change exactly one letter from the previous word.' });
      }
      const attemptsRemaining = game.attemptLimit - game.guesses.length - 1;
      const won = game.ladder ? attemptsRemaining === 0 : guess === game.answer;
      const completed = won || attemptsRemaining === 0;
      const result: Guess = { guess, feedback: game.ladder ? [] : score(game.answer, guess), attemptsRemaining, completed };
      result.definition = await this.dictionary.dictionaryDefinition(guess, true) ?? '';
      if (completed) {
        if (game.ladder) game.answer = guess;
        result.outcome = won ? 'WON' : 'LOST';
        result.answer = game.answer;
        result.answerDefinition = won ? result.definition : await this.dictionary.dictionaryDefinition(game.answer, true) ?? '';
        game.completed = true;
        game.status = won ? 'won' : 'lost';
        if (won) result.rewardCoins = game.winRewardCoins;
        game.completedAt = new Date().toISOString();
      }
      game.guesses.push(result);
      if (game.ladder) {
        delete game.clues.nextWord;
        game.hints.nextWord = completed ? 0 : 1;
      }
      return result;
    });
  }

  async abandon(id: string, owner: string) {
    return this.games.change(id,owner,game => {
      if (!game.completed && game.guesses.length > 0) throw new ConflictException(PUZZLE_ALREADY_STARTED);
      if (!game.completed) { game.completed=true; game.status='cancelled'; game.completedAt=new Date().toISOString(); }
      return { success:true };
    });
  }

  async giveUp(id: string, owner: string) {
    return this.games.change(id, owner, game => {
      if (!game.completed) {
        if (game.ladder) {
          const last = game.guesses.at(-1);
          game.answer = last?.guess ?? game.ladder.startWord;
          game.answerDefinition = last?.definition ?? game.ladder.startDefinition ?? '';
        }
        game.completed = true;
        game.gaveUp = true;
        game.status = 'lost';
        game.completedAt = new Date().toISOString();
      }
      return publicGame(game);
    });
  }

  private requireActive(game: Game) {
    if (game.completed) throw new BadRequestException({ code: 'GAME_FINISHED', message: 'This game is already complete.' });
  }
}

export { score } from './game.types';
