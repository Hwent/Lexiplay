import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameAudio } from './game-audio';

describe('game audio playback', () => {
  let sources: { buffer: unknown; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended?: () => void }[];
  let context: { state: string; destination: object; resume: ReturnType<typeof vi.fn>; decodeAudioData: ReturnType<typeof vi.fn>; createBufferSource: ReturnType<typeof vi.fn> };
  let audio: GameAudio;
  let removeListeners: () => void;
  const gesture = () => window.dispatchEvent(new Event('pointerdown'));
  const ready = async () => { gesture(); await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(8)); await Promise.resolve(); };

  beforeEach(() => {
    localStorage.clear();
    sources = [];
    context = {
      state: 'suspended', destination: {},
      resume: vi.fn(async () => { context.state = 'running'; }),
      decodeAudioData: vi.fn(async () => ({})),
      createBufferSource: vi.fn(() => {
        const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
        sources.push(source); return source;
      }),
    };
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8))));
    audio = new GameAudio();
    removeListeners = audio.listen();
  });
  afterEach(() => { removeListeners(); vi.unstubAllGlobals(); });

  it('unlocks on a gesture, caches assets, and releases completed sources', async () => {
    audio.play('win');
    expect(fetch).not.toHaveBeenCalled();
    await ready();
    expect(fetch).toHaveBeenCalledWith('/audio/type.wav');
    gesture();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(fetch).toHaveBeenCalledTimes(8);
    audio.play('type'); audio.play('coin');
    expect(sources).toHaveLength(2);
    expect(sources[0]!.start).toHaveBeenCalledOnce();
    sources[0]!.onended?.();
    expect(sources[0]!.disconnect).toHaveBeenCalledOnce();
    audio.stop();
    expect(sources[0]!.stop).not.toHaveBeenCalled();
    expect(sources[1]!.stop).toHaveBeenCalledOnce();
  });

  it('persists mute, stops playing effects immediately, and can re-enable playback', async () => {
    await ready();
    audio.play('win');
    audio.setEnabled(false);
    expect(sources[0]!.stop).toHaveBeenCalledOnce();
    audio.play('coin'); gesture();
    expect(sources).toHaveLength(1);
    expect(new GameAudio().enabled).toBe(false);
    audio.setEnabled(true);
    audio.play('coin');
    expect(sources).toHaveLength(2);
    expect(new GameAudio().enabled).toBe(true);
  });

  it('does not load audio when saved as muted or unsupported', async () => {
    audio.setEnabled(false);
    gesture();
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal('AudioContext', undefined);
    audio.setEnabled(true);
    gesture(); audio.play('win');
    expect(fetch).not.toHaveBeenCalled();
    expect(sources).toHaveLength(0);
  });

  it('stays silent during pronunciation, in hidden tabs, and when the context is suspended', async () => {
    await ready();
    vi.stubGlobal('speechSynthesis', { speaking: true });
    audio.play('hint');
    vi.stubGlobal('speechSynthesis', { speaking: false });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    audio.play('hint');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    context.state = 'suspended';
    audio.play('hint');
    expect(sources).toHaveLength(0);
    await ready();
    audio.play('hint');
    expect(sources).toHaveLength(1);
    window.dispatchEvent(new Event('lexiplay:before-route-change'));
    expect(sources[0]!.stop).toHaveBeenCalledOnce();
  });

  it('handles blocked playback and unavailable assets without interrupting play', async () => {
    context.resume.mockRejectedValue(new Error('Blocked'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    gesture();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(8));
    audio.play('win');
    expect(sources).toHaveLength(0);
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });
});
