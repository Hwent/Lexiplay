import { animalById, animals, featureValue, questionById, questions, type Animal, type FeatureQuestion } from './knowledge';
import { questionPolicy, questionReliability } from './question-policy';

export const QUESTION_LIMIT = 15;
export const GUESS_LIMIT = 3;
export type Answer = 'yes' | 'no' | 'not-sure';
export type AnsweredQuestion = { questionId: string; answer: Answer };
export type AnimalGuess = { animalId: string; correct: boolean };
export type Session = {
  version: 1;
  id: string;
  answers: AnsweredQuestion[];
  guesses: AnimalGuess[];
  status: 'active' | 'won' | 'lost';
  revealedAnswer: string;
  feedbackSent: boolean;
  completedAt?: string;
  practiceQueued?: boolean;
  questionSeed?: number;
  inferenceVersion?: 2;
};
export type Turn = { kind: 'question'; question: FeatureQuestion } | { kind: 'guess'; animal: Animal; tentative: boolean } | { kind: 'finished' };

export function newSession(): Session {
  return { version: 1, inferenceVersion: 2, id: crypto.randomUUID(), questionSeed: crypto.getRandomValues(new Uint32Array(1))[0]!, answers: [], guesses: [], status: 'active', revealedAnswer: '', feedbackSent: false };
}

function rankCandidates(session: Session) {
  const rejected = new Set(session.guesses.filter(guess => !guess.correct).map(guess => guess.animalId));
  const ranked = animals.filter(animal => !rejected.has(animal.id)).map(animal => {
    let score = 0;
    let evidenceCount = 0;
    const groups = new Map<string, number>();
    const contradictions = new Set<string>();
    const observations: { policy: ReturnType<typeof questionPolicy>; matches: boolean }[] = [];
    for (const { questionId, answer } of session.answers) {
      const expected = featureValue(animal, questionId);
      if (answer === 'not-sure' || expected === 'unknown') continue;
      const policy = questionPolicy(questionId);
      observations.push({ policy, matches: expected === answer });
      groups.set(policy.group, (groups.get(policy.group) ?? 0) + 1);
      evidenceCount++;
      if (expected !== answer && policy.reliability >= .9) contradictions.add(policy.group);
    }
    for (const { policy, matches } of observations) {
      const reliability = questionReliability(policy, groups.get(policy.group)! - 1);
      score += session.inferenceVersion === 2 ? Math.log(2 * (matches ? reliability : 1 - reliability)) : Math.log(matches ? 1.8 : .2);
    }
    return { animal, score, groups, contradictions, evidenceCount };
  });
  const max = Math.max(...ranked.map(item => item.score));
  const total = ranked.reduce((sum, item) => sum + Math.exp(item.score - max), 0);
  return ranked.map(candidate => ({ ...candidate, weight: Math.exp(candidate.score - max) / total }))
    .sort((a, b) => b.weight - a.weight || a.animal.id.localeCompare(b.animal.id));
}

export function rankAnimals(session: Session): { animal: Animal; weight: number }[] {
  return rankCandidates(session).map(({ animal, weight }) => ({ animal, weight }));
}

function entropy(probability: number): number {
  return probability <= 0 || probability >= 1 ? 0 : -probability * Math.log2(probability) - (1 - probability) * Math.log2(1 - probability);
}

export function nextTurn(session: Session): Turn {
  if (session.status !== 'active') return { kind: 'finished' };
  const ranked = rankCandidates(session), top = ranked[0];
  if (!top) return { kind: 'finished' };
  const answered = new Set(session.answers.map(item => item.questionId));
  const gains: { question: FeatureQuestion; gain: number }[] = [];
  let best: FeatureQuestion | undefined, bestGain = 0;
  for (const question of questions) {
    if (answered.has(question.id)) continue;
    let yes = 0, uncertainty = 0;
    for (const { animal, weight } of ranked) {
      const expected = featureValue(animal, question.id);
      const likelihood = expected === 'unknown' ? .5 : expected === 'yes' ? .9 : .1;
      yes += weight * likelihood;
      uncertainty += weight * entropy(likelihood);
    }
    const gain = entropy(yes) - uncertainty;
    gains.push({ question, gain });
    if (gain > bestGain + 1e-9) { best = question; bestGain = gain; }
  }
  const readyToGuess = session.inferenceVersion === 2
    ? top.evidenceCount >= 4 && top.groups.size >= 3 && top.contradictions.size <= 2
      && top.weight >= .72 && top.weight - (ranked[1]?.weight ?? 0) >= .45
      && (bestGain <= .4 || top.weight >= .9)
    : session.answers.length >= 4 && top.weight >= .72;
  if (session.answers.length >= QUESTION_LIMIT || !best || readyToGuess) {
    return { kind: 'guess', animal: top.animal, tentative: session.inferenceVersion === 2 ? !readyToGuess : top.weight < .72 };
  }
  if (session.questionSeed !== undefined) {
    const choices = gains.filter(item => item.gain >= bestGain * .9)
      .sort((a, b) => b.gain - a.gain).slice(0, 3);
    // A saved seed varies near-optimal questions without changing the turn on refresh.
    let value = session.questionSeed ^ Math.imul(session.answers.length + 1, 0x9e3779b1) ^ Math.imul(session.guesses.length, 0x85ebca6b);
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    best = choices[(value >>> 0) % choices.length]!.question;
  }
  return { kind: 'question', question: best };
}

export function answerQuestion(session: Session, answer: Answer): Session {
  const turn = nextTurn(session);
  if (turn.kind !== 'question') return session;
  return { ...session, answers: [...session.answers, { questionId: turn.question.id, answer }] };
}

export function changeLastAnswer(session: Session, answer: Answer): Session {
  if (session.status !== 'active' || !session.answers.length) return session;
  return { ...session, answers: session.answers.map((item, index) => index === session.answers.length - 1 ? { ...item, answer } : item) };
}

export function confirmGuess(session: Session, correct: boolean): Session {
  const turn = nextTurn(session);
  if (turn.kind !== 'guess') return session;
  const guesses = [...session.guesses, { animalId: turn.animal.id, correct }];
  const status = correct ? 'won' : guesses.length >= GUESS_LIMIT ? 'lost' : 'active';
  return { ...session, guesses, status, ...(status !== 'active' ? { completedAt: new Date().toISOString() } : {}) };
}

const STORAGE_KEY = 'lexiplay-animal-guess:v1';

export function saveSession(session: Session): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); return true; }
  catch { return false; }
}

export function restoreSession(): Session | null {
  try {
    const value: Session | null = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!value || value.version !== 1 || typeof value.id !== 'string' || !['active', 'won', 'lost'].includes(value.status)) return null;
    if (!Array.isArray(value.answers) || value.answers.length > QUESTION_LIMIT || !value.answers.every(item => item && questionById.has(item.questionId) && ['yes', 'no', 'not-sure'].includes(item.answer))) return null;
    if (new Set(value.answers.map(item => item.questionId)).size !== value.answers.length) return null;
    if (!Array.isArray(value.guesses) || value.guesses.length > GUESS_LIMIT || !value.guesses.every(item => item && animalById.has(item.animalId) && typeof item.correct === 'boolean')) return null;
    if (new Set(value.guesses.map(item => item.animalId)).size !== value.guesses.length) return null;
    const won = value.guesses.some(item => item.correct);
    if (won !== (value.status === 'won') || (value.status === 'active' && value.guesses.length >= GUESS_LIMIT)) return null;
    if (typeof value.revealedAnswer !== 'string' || value.revealedAnswer.length > 100 || typeof value.feedbackSent !== 'boolean') return null;
    if (value.completedAt !== undefined && (typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt)))) return null;
    if (value.practiceQueued !== undefined && typeof value.practiceQueued !== 'boolean') return null;
    if (value.questionSeed !== undefined && (!Number.isInteger(value.questionSeed) || value.questionSeed < 0 || value.questionSeed > 0xffffffff)) return null;
    if (value.inferenceVersion !== undefined && value.inferenceVersion !== 2) return null;
    return value;
  } catch { return null; }
}
