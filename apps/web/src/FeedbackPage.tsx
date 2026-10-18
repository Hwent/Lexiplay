import { useTranslation } from './i18n';
import { FormEvent, useRef, useState } from 'react';
import Icon from './Icon';
import { apiRequest } from './services/api-client';
import './feedback.css';

export default function FeedbackPage() {
  const t = useTranslation();
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !content.trim()) return;
    submitting.current = true; setSending(true); setError('');
    try {
      await apiRequest('/feedback', { method: 'POST', body: JSON.stringify({ content: content.trim() }) }, 'Could not send your feedback. Please try again.');
      setContent(''); setSent(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send your feedback. Please try again.'); }
    finally { submitting.current = false; setSending(false); }
  }

  return <section className="feedback-page" aria-label={t('Feedback')}>
    <div className="page-introduction"><div><h2>{t('Help shape ')}<span>{t('LexiPlay.')}</span></h2><p>{t('Share an idea, report a problem, or tell us what’s working.')}</p></div><span className="page-intro-icon" aria-hidden="true"><Icon name="feedback" /></span></div>
    <div className="feedback-card">
      {sent ? <div className="feedback-success"><span className="feature-icon"><Icon name="check" /></span><h3>{t('Thanks for sharing.')}</h3><p role="status">{t('Your feedback has been received.')}</p><button className="quiet-button" type="button" onClick={() => { setSent(false); requestAnimationFrame(() => input.current?.focus()); }}>{t('Send another message ')}<Icon name="arrow" /></button></div> : <form onSubmit={event => { void submit(event); }} aria-busy={sending}>
        <div className="feedback-form-heading"><h3>{t('What’s on your mind?')}</h3><span>{t('No sign-in needed')}</span></div>
        <label htmlFor="feedback-content">{t('Your message')}</label>
        <textarea ref={input} id="feedback-content" value={content} onChange={event => setContent(event.target.value)} maxLength={2000} required rows={7} disabled={sending} placeholder={t('I’d love to see…')} aria-describedby="feedback-count" />
        <div className="feedback-form-footer"><span id="feedback-count">{content.length.toLocaleString()} / 2,000</span><button className="primary-button" type="submit" disabled={sending || !content.trim()}>{sending ? t('Sending…') : t('Send feedback')}<Icon name="arrow" /></button></div>
        {error && <p className="feedback-error" role="alert">{t(error)}</p>}
      </form>}
    </div>
  </section>;
}
