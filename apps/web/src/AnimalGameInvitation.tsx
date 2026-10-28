import { useEffect, useRef } from 'react';
import { useTranslation } from './i18n';
import './game-completion.css';
import './animal-game-invitation.css';

export const ANIMAL_INVITATION_KEY = 'lexiplay-guess-animal-invitation-seen';

export function hasSeenAnimalInvitation() {
  try { return localStorage.getItem(ANIMAL_INVITATION_KEY) === 'true'; }
  catch { return false; }
}

export default function AnimalGameInvitation({ onDismiss, onPlay }: { onDismiss: () => void; onPlay: () => void }) {
  const t = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { localStorage.setItem(ANIMAL_INVITATION_KEY, 'true'); } catch { /* Still dismissible when storage is unavailable. */ }
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return <div className="guest-game-backdrop" onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}>
    <div className="guest-game-dialog animal-invitation" role="dialog" aria-modal="true" aria-labelledby="animal-invitation-title" aria-describedby="animal-invitation-copy" ref={dialogRef} tabIndex={-1} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onDismiss(); }
      if (event.key === 'Tab') {
        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button');
        const first = buttons?.[0], last = buttons?.[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="animal-invitation-art" aria-hidden="true">
        <svg viewBox="0 0 120 100" focusable="false"><path d="M30 55 17 17l31 16M90 55l13-38-31 16"/><path d="M93 60c0 22-15 31-33 31S27 82 27 60s15-33 33-33 33 11 33 33Z"/><path d="M44 59h.01M76 59h.01" className="animal-invitation-eyes"/><path d="m54 72 6 5 6-5M60 77v7"/></svg>
        <span>?</span>
      </div>
      <h2 id="animal-invitation-title">{t('Try Guess Animal')}</h2>
      <p id="animal-invitation-copy">{t('Think of an animal. Answer a few questions and see if we can guess it.')}</p>
      <div className="guest-game-actions animal-invitation-actions">
        <button className="primary-button" type="button" onClick={onPlay}>{t('Play Guess Animal')}</button>
        <button className="quiet-button" type="button" onClick={onDismiss}>{t('Maybe later')}</button>
      </div>
    </div>
  </div>;
}
