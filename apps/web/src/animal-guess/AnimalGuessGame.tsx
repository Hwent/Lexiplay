import { useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Icon from '../Icon';
import PronunciationButton from '../PronunciationButton';
import { LanguageContext, useTranslation } from '../i18n';
import { apiRequest } from '../services/api-client';
import { gameAudio } from '../services/game-audio';
import { answerQuestion, changeLastAnswer, confirmGuess, GUESS_LIMIT, newSession, nextTurn, QUESTION_LIMIT, restoreSession, saveSession, type Answer, type Session } from './engine';
import { animalById, findAnimal, KNOWLEDGE_VERSION, questionById, type FeatureQuestion } from './knowledge';
import { englishKeywordMeanings } from './keyword-meanings';
import { queueAnimalPractice, syncAnimalPractice } from './practice-progress';
import './animal-guess.css';

const KEYWORD_HINT_KEY = 'lexiplay-animal-keyword-hint-seen';
const answers: { value: Answer; label: string; icon: 'check' | 'close' | 'help' }[] = [
  { value: 'yes', label: 'Yes', icon: 'check' },
  { value: 'no', label: 'No', icon: 'close' },
  { value: 'not-sure', label: 'Maybe', icon: 'help' },
];

function Question({ question, showHint, onKeywordOpen }: { question: FeatureQuestion; showHint: boolean; onKeywordOpen: () => void }) {
  const t = useTranslation(), meaningId = useId();
  const language = useContext(LanguageContext);
  const meanings = language === 'zh-CN' ? question.keywords : englishKeywordMeanings;
  const [selected, setSelected] = useState('');
  const words = Object.keys(question.keywords).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return <div className="animal-question-copy" lang="en">
    <h2>{question.text.split(pattern).map((part, index) => question.keywords[part]
      ? <button className="animal-keyword" key={index} type="button" aria-expanded={selected === part} aria-controls={meaningId} onClick={() => { setSelected(selected === part ? '' : part); if (selected !== part) onKeywordOpen(); }}>{part}</button>
      : part)}</h2>
    <div className="animal-keyword-meaning" id={meaningId} role="status">{selected
      ? <span lang={language}><strong lang="en">{selected}</strong> · {meanings[selected]}</span>
      : showHint ? <span className="animal-keyword-hint" lang={language}>{t('Tap underlined words for meanings')}</span> : null}</div>
  </div>;
}

function AnswerButtons({ onAnswer, selected }: { onAnswer: (answer: Answer) => void; selected?: Answer }) {
  const t = useTranslation();
  return <div className="animal-answer-buttons" role="group" aria-label={t('Your answer')}>
    {answers.map(answer => <button key={answer.value} type="button" className={`quiet-button animal-answer-${answer.value}`} aria-pressed={selected === undefined ? undefined : selected === answer.value} onClick={() => onAnswer(answer.value)}><Icon name={answer.icon}/><span>{t(answer.label)}</span></button>)}
  </div>;
}

export default function AnimalGuessGame({ bookmark, practiceOwner = 'guest' }: { bookmark: (term: string, definition: string) => ReactNode; practiceOwner?: string | null }) {
  const t = useTranslation();
  const language = useContext(LanguageContext);
  const [session, setSession] = useState<Session | null>(restoreSession);
  const [editing, setEditing] = useState(false);
  const [keywordHintSeen, setKeywordHintSeen] = useState(() => {
    try { return localStorage.getItem(KEYWORD_HINT_KEY) === 'true'; } catch { return false; }
  });
  const [showChinese, setShowChinese] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [feedbackAnswer, setFeedbackAnswer] = useState(() => session?.revealedAnswer ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const turn = session ? nextTurn(session) : null;
  const lastAnswer = session?.answers.at(-1);
  const previousQuestion = lastAnswer ? questionById.get(lastAnswer.questionId) : undefined;
  const animal = turn?.kind === 'guess' ? turn.animal : undefined;
  const learned = session?.status === 'won' ? animalById.get(session.guesses.at(-1)!.animalId)
    : session?.revealedAnswer ? findAnimal(session.revealedAnswer) : undefined;
  const finished = session !== null && session.status !== 'active';

  useEffect(() => { if (session) setStorageError(!saveSession(session)); }, [session]);
  useEffect(() => {
    if (!practiceOwner || !session?.completedAt || session.practiceQueued || session.status === 'active') return;
    if (session.status === 'lost' && session.guesses.length !== GUESS_LIMIT) return;
    queueAnimalPractice({ roundId: session.id, status: session.status, questionCount: session.answers.length,
      guessCount: session.guesses.length, completedAt: session.completedAt }, practiceOwner);
    setSession(current => current?.id === session.id ? { ...current, practiceQueued: true } : current);
    void syncAnimalPractice(practiceOwner);
  }, [session, practiceOwner]);
  useEffect(() => {
    setShowChinese(false);
    if (session) panel.current?.focus({ preventScroll: true });
  }, [session?.id, session?.answers.length, session?.guesses.length, session?.status, editing]);

  function start() {
    setSession(newSession()); setEditing(false); setFeedbackAnswer(''); setError('');
  }

  function rememberKeywordUse() {
    if (keywordHintSeen) return;
    setKeywordHintSeen(true);
    try { localStorage.setItem(KEYWORD_HINT_KEY, 'true'); } catch { /* Keep the hint dismissed during this visit. */ }
  }

  function answer(value: Answer) {
    if (!session) return;
    setSession(current => current === session ? editing ? changeLastAnswer(current, value) : answerQuestion(current, value) : current);
    setEditing(false); gameAudio.play('guess');
  }

  function confirm(correct: boolean) {
    if (!session) return;
    const updated = confirmGuess(session, correct);
    setSession(updated);
    gameAudio.play(correct ? 'win' : updated.status === 'lost' ? 'complete' : 'guess');
  }

  async function sendAnswer(event: FormEvent) {
    event.preventDefault();
    const supplied = feedbackAnswer.trim();
    if (!session || !supplied || submitting.current || session.feedbackSent) return;
    submitting.current = true; setSending(true); setError('');
    const id = session.id;
    setSession(current => current ? { ...current, revealedAnswer: supplied } : current);
    const content = [
      `Guess Animal / animals v${KNOWLEDGE_VERSION} / ${id}`,
      `Player's animal: ${supplied}`,
      `Questions: ${session.answers.map(item => `${item.questionId}=${item.answer}`).join(', ')}`,
      `Rejected guesses: ${session.guesses.map(item => item.animalId).join(', ')}`,
    ].join('\n');
    try {
      await apiRequest('/feedback', { method: 'POST', body: JSON.stringify({ content }) }, 'Could not send your feedback. Please try again.');
      setSession(current => current?.id === id ? { ...current, feedbackSent: true } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send your feedback. Please try again.'); }
    finally { submitting.current = false; setSending(false); }
  }

  return <section className="game-card animal-guess-game" aria-label={t('Guess Animal')}>
    {!session ? <div className="welcome-card">
      <div className="practice-story">
        <h2>{t('Guess Animal')}</h2>
        <div className="game-guide">
          <svg className="animal-guide-picture" viewBox="0 0 360 270" role="img" aria-label={t('Answer questions to reveal an animal')}>
            <rect className="animal-guide-bubble" x="105" y="24" width="150" height="120" rx="20"/>
            <text className="animal-guide-mark" x="180" y="106" textAnchor="middle">?</text>
            <path className="animal-guide-branches" d="M180 144v32M60 200v-24h240v24M180 176v24"/>
            {answers.map(({ label }, index) => <g key={label} transform={`translate(${10 + index * 120}, 200)`}><rect className="animal-guide-answer" width="100" height="42" rx="8"/><text className="animal-guide-label" x="50" y="26" textAnchor="middle">{t(label)}</text></g>)}
          </svg>
          <details className="game-rules"><summary>{t('How to play')}</summary>
            <p>{t('Think of a common animal. Answer Yes, No or Maybe, and see if I can guess it.')}</p>
            <p>{t('You do not need to know its English name. Tap underlined words for help.')}</p>
            <p>{t('Think of the usual animal, not a particular breed. You can change your previous answer.')}</p>
          </details>
        </div>
      </div>
      <div className="practice-setup animal-setup">
        <div className="practice-setup-heading"><h3>{t('Think of an animal.')}</h3><p>{t('Keep it secret. Let me ask the questions.')}</p></div>
        <div className="animal-round-limits"><div><strong>{QUESTION_LIMIT}</strong><span>{t('Questions')}</span></div><div><strong>{GUESS_LIMIT}</strong><span>{t('Guesses')}</span></div></div>
        <span className="animal-free"><Icon name="check"/>{t('Free to play')}</span>
        <button className="primary-button" type="button" onClick={start}>{t('I have an animal in mind')}<Icon name="arrow"/></button>
      </div>
    </div> : <div className="puzzle animal-round">
      <div className="puzzle-heading"><div><p className="eyebrow">{t('Guess Animal · Animals')}</p><h2>{t(finished ? 'Round complete' : 'Keep your animal in mind.')}</h2></div>
        <div className="animal-counters"><span className="attempt-counter">{t('{0} / {1} questions', session.answers.length, QUESTION_LIMIT)}</span><span className="attempt-counter">{t('{0} / {1} guesses', session.guesses.length, GUESS_LIMIT)}</span></div>
      </div>
      {!finished && <div className="puzzle-tools"><button className="account-link" type="button" disabled={!lastAnswer || editing} onClick={() => setEditing(true)}>{t('Change previous answer')}</button><button className="account-link" type="button" onClick={() => { setSession({ ...session, status: 'lost' }); setEditing(false); gameAudio.play('complete'); }}>{t('Give up')}</button></div>}
      <div ref={panel} tabIndex={-1} className="animal-turn" key={`${turn?.kind}-${turn?.kind === 'question' ? turn.question.id : animal?.id}-${editing}`}>
        {editing && previousQuestion && lastAnswer ? <>
          <p className="animal-step-label">{t('Change your previous answer')}</p>
          <Question key={previousQuestion.id} question={previousQuestion} showHint={!keywordHintSeen} onKeywordOpen={rememberKeywordUse}/>
          <AnswerButtons onAnswer={answer} selected={lastAnswer.answer}/>
          <button className="account-link animal-cancel-edit" type="button" onClick={() => setEditing(false)}>{t('Cancel')}</button>
        </> : turn?.kind === 'question' ? <>
          <p className="animal-step-label">{t('Question {0} / {1}', session.answers.length + 1, QUESTION_LIMIT)}</p>
          <Question key={turn.question.id} question={turn.question} showHint={!keywordHintSeen} onKeywordOpen={rememberKeywordUse}/>
          <AnswerButtons onAnswer={answer}/>
        </> : animal && turn?.kind === 'guess' ? <>
          <p className="animal-step-label">{t(turn.tentative ? 'Let me try a guess.' : 'I think I have it.')}</p>
          <h2 className="animal-guess-prompt" lang="en">Is it a{ /^[aeiou]/i.test(animal.id) ? 'n' : '' } <strong>{animal.id}</strong>?</h2>
          <div className="animal-reveal"><button className="quiet-button" type="button" aria-expanded={showChinese} onClick={() => setShowChinese(!showChinese)}><Icon name="language"/>{t(showChinese ? 'Hide Chinese' : 'Show Chinese')}</button>{showChinese && <span lang="zh-CN">{animal.chinese}</span>}</div>
          <div className="animal-answer-buttons animal-confirm-buttons"><button className="quiet-button animal-answer-yes" type="button" onClick={() => confirm(true)}><Icon name="check"/><span>{t('You guessed it')}</span></button><button className="quiet-button animal-answer-no" type="button" onClick={() => confirm(false)}><Icon name="close"/><span>{t('Not my animal')}</span></button></div>
        </> : finished ? <>
          <span className="animal-result-icon" aria-hidden="true"><Icon name={session.status === 'won' ? 'check' : 'search'}/></span>
          <h2>{t(session.status === 'won' ? 'Found your animal.' : 'You stumped me.')}</h2>
        </> : null}
      </div>
      {learned && <div className="answer-definition animal-learning-card"><div><p className="eyebrow">{t('YOUR ANIMAL')}</p><div className="word-with-pronunciation"><strong lang="en">{learned.id}</strong><PronunciationButton term={learned.id}/></div>{language === 'zh-CN' && <span className="animal-chinese" lang="zh-CN">{learned.chinese}</span>}<p lang="en">{learned.definition}</p></div>{bookmark(learned.id, learned.definition)}</div>}
      {session.status === 'lost' && <div className="animal-feedback">
        {session.feedbackSent ? <p role="status"><Icon name="check"/>{t('Thanks. Your answer is saved for review.')}</p> : <form onSubmit={event => { void sendAnswer(event); }} aria-busy={sending}>
          <label htmlFor="animal-feedback-answer">{t('What animal were you thinking of?')}</label>
          <p>{t('Optional · English or Chinese. Help improve the next round.')}</p>
          <div className="animal-feedback-input"><input id="animal-feedback-answer" value={feedbackAnswer} onChange={event => setFeedbackAnswer(event.target.value)} maxLength={100} placeholder={t('Animal name')} disabled={sending}/><button className="quiet-button" type="submit" disabled={sending || !feedbackAnswer.trim()}>{t(sending ? 'Sending…' : 'Send answer')}<Icon name="arrow"/></button></div>
        </form>}
        {session.revealedAnswer && !learned && <p className="animal-unknown-answer"><strong>{session.revealedAnswer}</strong> · {t('Not in this starter set yet.')}</p>}
        {error && <p className="feedback-error" role="alert">{t(error)}</p>}
      </div>}
      {finished && <div className="next-game"><button className="primary-button" type="button" onClick={start} disabled={sending}>{t('Play again')}</button></div>}
      {session.answers.length > 0 && <details className="animal-history"><summary>{t('Your answers')} <span>{session.answers.length}</span></summary><ol>{session.answers.map(item => <li key={item.questionId}><span lang="en">{questionById.get(item.questionId)?.text}</span><strong>{t(answers.find(answer => answer.value === item.answer)!.label)}</strong></li>)}</ol>{session.guesses.length > 0 && <p>{t('Guesses made: {0}', session.guesses.map(item => item.animalId).join(' · '))}</p>}</details>}
    </div>}
    {storageError && <p className="notice" role="status">{t('Progress could not be saved on this device. Keep this page open to finish your round.')}</p>}
  </section>;
}
