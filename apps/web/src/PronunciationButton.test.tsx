import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PronunciationButton from './PronunciationButton';

class Utterance {
  constructor(readonly text: string) {}
  lang = '';
  rate = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
}

function speechMock() {
  let current: Utterance | null = null;
  const localVoice = { lang: 'en-CA', localService: true };
  const speech = {
    getVoices: vi.fn(() => [{ lang: 'fr-CA', localService: true }, localVoice]),
    speak: vi.fn((utterance: Utterance) => { current = utterance; }),
    cancel: vi.fn(() => { current?.onerror?.({ error: 'canceled' }); current = null; }),
  };
  vi.stubGlobal('speechSynthesis', speech);
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  return { speech, localVoice };
}

describe('word pronunciation', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('pronounces only the word with an English voice and stops playback on request', async () => {
    const { speech, localVoice } = speechMock();
    const user = userEvent.setup();
    render(<PronunciationButton term="apple" />);
    await user.click(screen.getByRole('button', { name: 'Pronounce apple' }));
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.speak.mock.calls[0]![0]).toMatchObject({ text: 'apple', lang: 'en-CA', rate: .85, voice: localVoice });
    expect(screen.getByRole('button', { name: 'Stop pronouncing apple' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Stop pronouncing apple' }));
    expect(screen.getByRole('button', { name: 'Pronounce apple' })).toHaveAttribute('aria-pressed', 'false');
    expect(speech.cancel).toHaveBeenCalledTimes(2);
  });

  it('handles unavailable speech and playback failures gracefully', async () => {
    vi.stubGlobal('speechSynthesis', undefined);
    const page = render(<PronunciationButton term="apple" />);
    expect(screen.getByRole('button', { name: 'Pronounce apple' })).toBeDisabled();
    page.unmount();
    const { speech } = speechMock();
    const user = userEvent.setup();
    render(<PronunciationButton term="apple" />);
    await user.click(screen.getByRole('button', { name: 'Pronounce apple' }));
    act(() => speech.speak.mock.calls[0]![0].onerror?.({ error: 'audio-busy' }));
    expect(screen.getByRole('status')).toHaveTextContent('Could not play pronunciation. Try again.');
    expect(screen.getByRole('button', { name: 'Pronounce apple' })).toBeEnabled();
  });

  it('cancels an earlier word and stops active speech when the word leaves the page', async () => {
    const { speech } = speechMock();
    const user = userEvent.setup();
    const page = render(<><PronunciationButton term="apple" /><PronunciationButton term="brave" /></>);
    await user.click(screen.getByRole('button', { name: 'Pronounce apple' }));
    await user.click(screen.getByRole('button', { name: 'Pronounce brave' }));
    expect(screen.getByRole('button', { name: 'Pronounce apple' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Stop pronouncing brave' })).toHaveAttribute('aria-pressed', 'true');
    page.unmount();
    expect(speech.cancel).toHaveBeenCalledTimes(3);
  });
});
