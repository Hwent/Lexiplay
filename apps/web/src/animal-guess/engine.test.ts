import { describe, expect, it } from 'vitest';
import { animals, featureValue, findAnimal, questions } from './knowledge';
import { englishKeywordMeanings } from './keyword-meanings';
import { answerQuestion, changeLastAnswer, confirmGuess, GUESS_LIMIT, newSession, nextTurn, QUESTION_LIMIT, rankAnimals, restoreSession, saveSession, type Session } from './engine';
import { questionPolicy } from './question-policy';

function play(animalId: string, wrongAt = -1, questionSeed = 42): Session {
  const target = animals.find(animal => animal.id === animalId)!;
  let session: Session = { ...newSession(), questionSeed };
  for (let steps = 0; steps < QUESTION_LIMIT + GUESS_LIMIT; steps++) {
    const turn = nextTurn(session);
    if (turn.kind === 'finished') break;
    if (turn.kind === 'guess') session = confirmGuess(session, turn.animal.id === target.id);
    else {
      const value = featureValue(target, turn.question.id);
      const answer = value === 'unknown' ? 'not-sure' : session.answers.length === wrongAt ? value === 'yes' ? 'no' : 'yes' : value;
      session = answerQuestion(session, answer);
    }
  }
  return session;
}

describe('animal guessing knowledge and inference', () => {
  it('keeps a complete, distinct and translated playable animal set', () => {
    expect(animals).toHaveLength(100);
    expect(new Set(animals.map(animal => animal.id)).size).toBe(animals.length);
    expect(new Set(questions.map(question => question.id)).size).toBe(questions.length);
    const features = new Set(questions.map(question => question.id));
    for (const animal of animals) {
      expect(animal.chinese).toMatch(/[\u4e00-\u9fff]/);
      expect(animal.definition.length).toBeGreaterThan(15);
      for (const feature of [...animal.yes, ...animal.unknown]) expect(features.has(feature), `${animal.id}: ${feature}`).toBe(true);
      expect(animal.yes.some(feature => animal.unknown.includes(feature))).toBe(false);
    }
    for (const question of questions) for (const word of Object.keys(question.keywords)) {
      expect(question.text.includes(word)).toBe(true);
      expect(englishKeywordMeanings[word], `Missing English explanation: ${word}`).toBeTruthy();
    }
  });

  it.each(animals.map(animal => animal.id))('guesses %s from its known features within both limits', id => {
    for (const seed of [3, 17, 2026]) {
      const session = play(id, -1, seed);
      expect(session.status, `seed ${seed}`).toBe('won');
      expect(session.answers.length).toBeGreaterThanOrEqual(4);
      expect(session.answers.length).toBeLessThanOrEqual(QUESTION_LIMIT);
      expect(session.guesses.length).toBeLessThanOrEqual(GUESS_LIMIT);
    }
  });

  it('varies strong opening questions between rounds while keeping saved turns stable', () => {
    const openings = new Set<string>();
    for (let questionSeed = 0; questionSeed < 16; questionSeed++) {
      const session = { ...newSession(), questionSeed };
      const first = nextTurn(session);
      expect(nextTurn(session)).toEqual(first);
      if (first.kind !== 'question') throw new Error('Expected an opening question');
      openings.add(first.question.id);
      expect(['mammal','fourLegs','fur']).toContain(first.question.id);
      const answered = answerQuestion(session, 'no');
      saveSession(answered);
      expect(nextTurn(restoreSession()!)).toEqual(nextTurn(answered));
    }
    expect(openings.size).toBeGreaterThan(1);
  });

  it('preserves the original selection strategy for rounds saved without a seed', () => {
    const { questionSeed: _seed, inferenceVersion: _inference, ...legacy } = newSession();
    const first = nextTurn(legacy);
    expect(first.kind === 'question' && first.question.id).toBe('mammal');
    const answered = answerQuestion(legacy, 'yes');
    saveSession(answered);
    expect(nextTurn(restoreSession()!)).toEqual(nextTurn(answered));
  });

  it('uses gentler penalties for ambiguous questions and stronger evidence for distinctive traits', () => {
    function odds(questionId: string, yes: string, no: string) {
      const ranked = rankAnimals({ ...newSession(), answers: [{ questionId, answer: 'yes' }] });
      return ranked.find(item => item.animal.id === yes)!.weight / ranked.find(item => item.animal.id === no)!.weight;
    }
    expect(odds('trunk','elephant','tiger')).toBeGreaterThan(odds('mammal','tiger','crocodile'));
    expect(odds('mammal','tiger','crocodile')).toBeGreaterThan(odds('nocturnal','tiger','horse'));
  });

  it('discounts related observations without depending on their answer order', () => {
    const one = { ...newSession(), answers: [{ questionId: 'mammal', answer: 'yes' as const }] };
    const two = { ...one, answers: [...one.answers, { questionId: 'fur', answer: 'yes' as const }] };
    const odds = (session: Session) => {
      const ranked = rankAnimals(session);
      return ranked.find(item => item.animal.id === 'tiger')!.weight / ranked.find(item => item.animal.id === 'crocodile')!.weight;
    };
    expect(odds(two)).toBeGreaterThan(odds(one));
    expect(odds(two)).toBeLessThan(odds(one) ** 2);
    expect(rankAnimals({ ...two, answers: [...two.answers].reverse() })).toEqual(rankAnimals(two));
    expect(rankAnimals({ ...one, answers: [...one.answers, { questionId: 'fur', answer: 'not-sure' }] })).toEqual(rankAnimals(one));
  });

  it('asks for independent evidence instead of guessing from repeated plumage traits', () => {
    const session = { ...newSession(), answers: ['bird','feathers','fanTail','eyeTail','colourful'].map(questionId => ({ questionId, answer: 'yes' as const })) };
    const top = rankAnimals(session)[0]!;
    expect(top.animal.id).toBe('peacock');
    expect(top.weight).toBeGreaterThanOrEqual(.72);
    expect(new Set(session.answers.map(item => questionPolicy(item.questionId).group)).size).toBe(1);
    expect(nextTurn(session).kind).toBe('question');
  });

  it.each([0, 1, 2, 3])('recovers from a mistaken answer at question index %s across the animal set', index => {
    const results = animals.map(animal => play(animal.id, index));
    const wins = results.filter(session => session.status === 'won').length;
    expect(wins / results.length).toBeGreaterThanOrEqual(.8);
  }, 20_000);

  it('keeps all candidates on Not Sure and still makes three distinct guesses after fifteen questions', () => {
    let session = newSession();
    for (let index = 0; index < QUESTION_LIMIT; index++) session = answerQuestion(session, 'not-sure');
    expect(session.answers).toHaveLength(QUESTION_LIMIT);
    expect(new Set(session.answers.map(item => item.questionId)).size).toBe(QUESTION_LIMIT);
    expect(new Set(rankAnimals(session).map(item => item.weight)).size).toBe(1);
    for (let index = 0; index < GUESS_LIMIT; index++) {
      expect(nextTurn(session).kind).toBe('guess');
      session = confirmGuess(session, false);
    }
    expect(new Set(session.guesses.map(item => item.animalId)).size).toBe(GUESS_LIMIT);
    expect(session.status).toBe('lost');
    expect(nextTurn(session)).toEqual({ kind: 'finished' });
    expect(confirmGuess(session, true)).toBe(session);
  });

  it('recomputes after editing an answer without spending another question', () => {
    const session = answerQuestion(newSession(), 'yes');
    const changed = changeLastAnswer(session, 'no');
    const direct = answerQuestion({ ...session, answers: [] }, 'no');
    expect(changed.answers).toHaveLength(1);
    expect(rankAnimals(changed)).toEqual(rankAnimals(direct));
    expect(session.answers[0]!.answer).toBe('yes');
  });

  it('restores question and guess progress and rejects damaged or stale drafts', () => {
    localStorage.clear();
    const session = play('tiger');
    expect(saveSession(session)).toBe(true);
    expect(restoreSession()).toEqual(session);
    localStorage.setItem('lexiplay-animal-guess:v1', '{');
    expect(restoreSession()).toBeNull();
    localStorage.setItem('lexiplay-animal-guess:v1', JSON.stringify({ ...session, version: 0 }));
    expect(restoreSession()).toBeNull();
    localStorage.setItem('lexiplay-animal-guess:v1', JSON.stringify({ ...session, answers: [{ questionId: 'removed', answer: 'yes' }] }));
    expect(restoreSession()).toBeNull();
  });

  it('recognizes supplied Chinese names and English aliases without inventing animals', () => {
    expect(findAnimal(' 海豚 ')?.id).toBe('dolphin');
    expect(findAnimal('a hippo')?.id).toBe('hippopotamus');
    expect(findAnimal('Giant Panda')?.id).toBe('panda');
    expect(findAnimal('unicorn')).toBeUndefined();
  });
});
