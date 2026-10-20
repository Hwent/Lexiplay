import { type RefObject, useEffect, useRef } from 'react';
import { useTranslation } from './i18n';
import NewAccountReward from './NewAccountReward';

export default function GuestGameReminder({ onDismiss, onSignIn, onCreateAccount, returnFocusRef }: {
  onDismiss: () => void; onSignIn: () => void; onCreateAccount: () => void; returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      const target = returnFocusRef.current ?? previous;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [returnFocusRef]);
  return <div className="guest-game-backdrop" onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}>
    <div className="guest-game-dialog" role="dialog" aria-modal="true" aria-labelledby="guest-game-title" aria-describedby="guest-game-copy" ref={dialogRef} tabIndex={-1} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onDismiss(); }
      if (event.key === 'Tab') {
        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button');
        const first = buttons?.[0], last = buttons?.[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <h2 id="guest-game-title">{t('Keep your progress.')}</h2>
      <p id="guest-game-copy">{t('Sign in to save your game history and words.')}</p>
      <NewAccountReward/>
      <div className="guest-game-actions">
        <button className="primary-button" type="button" onClick={onCreateAccount}>{t('Create account')}</button>
        <button className="quiet-button" type="button" onClick={onSignIn}>{t('Sign in')}</button>
        <button className="account-link" type="button" onClick={onDismiss}>{t('Continue as guest')}</button>
      </div>
    </div>
  </div>;
}
