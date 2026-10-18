const effects = ['type', 'delete', 'guess', 'invalid', 'hint', 'coin', 'win', 'complete'] as const;
export type GameSound = typeof effects[number];
const STORAGE_KEY = 'lexiplay-sound-enabled';

export class GameAudio {
  enabled = true;
  private context: AudioContext | null = null;
  private buffers = new Map<GameSound, AudioBuffer>();
  private sources = new Set<AudioBufferSourceNode>();

  constructor() {
    try { this.enabled = localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { /* Use the default when storage is unavailable. */ }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* Keep the preference for this visit. */ }
    if (enabled) this.unlock();
    else this.stop();
  }

  listen() {
    // Resume inside a gesture so feedback can also play after an API response.
    const unlock = () => this.unlock();
    const stop = () => this.stop();
    const visibility = () => { if (document.hidden) this.stop(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('lexiplay:before-route-change', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('lexiplay:before-route-change', stop);
      document.removeEventListener('visibilitychange', visibility);
      this.stop();
    };
  }

  private unlock() {
    if (!this.enabled || typeof window.AudioContext !== 'function') return;
    try {
      if (!this.context) {
        const context = new AudioContext();
        this.context = context;
        for (const effect of effects) {
          void fetch(`${import.meta.env.BASE_URL}audio/${effect}.wav`)
            .then(response => { if (!response.ok) throw new Error('Sound unavailable'); return response.arrayBuffer(); })
            .then(data => context.decodeAudioData(data))
            .then(buffer => { this.buffers.set(effect, buffer); })
            .catch(() => {});
        }
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio is optional; browser restrictions must not interrupt play. */ }
  }

  play(effect: GameSound) {
    const buffer = this.buffers.get(effect);
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running' || !buffer || document.hidden || window.speechSynthesis?.speaking) return;
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => { this.sources.delete(source); source.disconnect(); };
      this.sources.add(source);
      source.start();
    } catch { /* Keep gameplay working if the audio device becomes unavailable. */ }
  }

  stop() {
    for (const source of this.sources) source.stop();
    this.sources.clear();
  }
}

export const gameAudio = new GameAudio();
