import { FormEvent, useState } from 'react';

type Feedback = 'CORRECT' | 'PRESENT' | 'ABSENT';
type GuessResult = {
  guess: string;
  feedback: Feedback[];
  attemptsRemaining: number;
  completed: boolean;
  outcome?: 'WON' | 'LOST';
  answer?: string;
};
type Game = { id: string; wordLength: number; attemptLimit: number; guesses: GuessResult[] };

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? 'Something went wrong. Please try again.');
  return payload as T;
};

export default function App() {
  const [game, setGame] = useState<Game | null>(null);
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function startPractice() {
    setBusy(true);
    setMessage('');
    try {
      const newGame = await api<Game>('/games', { method: 'POST' });
      setGame(newGame);
      setGuess('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start practice.');
    } finally {
      setBusy(false);
    }
  }

  async function submitGuess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!game || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api<GuessResult>(`/games/${game.id}/guesses`, {
        method: 'POST',
        body: JSON.stringify({ guess: guess.trim().toLowerCase() }),
      });
      setGame({ ...game, guesses: [...game.guesses, result] });
      setGuess('');
      if (result.completed) {
        setMessage(result.outcome === 'WON'
          ? 'You found it! A new word is ready whenever you are.'
          : `Practice complete. The answer was ${result.answer}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not submit your guess.');
    } finally {
      setBusy(false);
    }
  }

  const finished = game?.guesses.at(-1)?.completed ?? false;
  const attemptsRemaining = game?.guesses.at(-1)?.attemptsRemaining ?? game?.attemptLimit ?? 0;

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="LexiPlay home"><span className="brand-mark">L</span> LexiPlay</a>
        <span className="top-note">A little practice, every day</span>
      </header>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Your daily word garden</p>
        <h1 id="page-title">Make words<br /><em>stick.</em></h1>
        <p className="intro">A calm little challenge to grow your vocabulary, one guess at a time.</p>
      </section>

      <section className="game-card" aria-label="Vocabulary puzzle">
        {!game ? (
          <div className="welcome-card">
            <div className="sample-grid" aria-hidden="true">
              {['G', 'R', 'O', 'W', 'S'].map((letter, index) => <span className={`sample-tile tile-${index}`} key={letter}>{letter}</span>)}
            </div>
            <h2>A fresh word is waiting.</h2>
            <p>Guess a five-letter word in six tries. You’ll get a hint after each guess.</p>
            <button className="primary-button" onClick={startPractice} disabled={busy}>
              {busy ? 'Getting a word…' : 'Start practice'} <span aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          <div className="puzzle">
            <div className="puzzle-heading">
              <div><p className="eyebrow">Today’s practice</p><h2>Find the word</h2></div>
              <span className="attempt-counter" aria-live="polite">{attemptsRemaining} {attemptsRemaining === 1 ? 'guess' : 'guesses'} remaining</span>
            </div>
            <div className="guess-board" role="list" aria-label="Puzzle board">
              {Array.from({ length: game.attemptLimit }, (_, row) => {
                const result = game.guesses[row];
                return <div className="guess-row" role="listitem" aria-label={result?.guess ?? `Guess ${row + 1}`} key={row}>
                  {Array.from({ length: game.wordLength }, (_, column) => {
                    const letter = result?.guess[column] ?? '';
                    const state = result?.feedback[column]?.toLowerCase() ?? '';
                    return <span role="gridcell" aria-label={letter ? `${letter}, ${state}` : 'Empty'} className={`letter-tile ${state}`} key={column}>{letter}</span>;
                  })}
                  {result && <span className="sr-only">{result.guess}</span>}
                </div>;
              })}
            </div>
            {!finished && <form className="guess-form" onSubmit={submitGuess}>
              <label htmlFor="guess-input">Your five-letter guess</label>
              <div className="guess-controls">
                <input id="guess-input" aria-label="Your five-letter guess" value={guess} onChange={event => setGuess(event.target.value.replace(/[^a-z]/gi, '').slice(0, game.wordLength))} maxLength={game.wordLength} autoComplete="off" autoCapitalize="none" />
                <button className="primary-button submit-button" type="submit" disabled={busy || guess.length !== game.wordLength}>{busy ? 'Checking…' : 'Guess'}</button>
              </div>
            </form>}
          </div>
        )}
      {message && <p className="notice" role="status">{message}</p>}
      {finished && <div className="next-game"><button className="primary-button" onClick={startPractice} disabled={busy}>Try another word <span aria-hidden="true">→</span></button></div>}
      </section>
      <footer><span>Thoughtful practice, one word at a time.</span><span className="footer-seed" aria-hidden="true">✳</span></footer>
    </main>
  );
}
