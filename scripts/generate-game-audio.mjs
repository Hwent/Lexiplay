import { mkdir, writeFile } from 'node:fs/promises';

// Original synthesized effects. Run with: node scripts/generate-game-audio.mjs
const sampleRate = 24000;
const directory = new URL('../apps/web/public/audio/', import.meta.url);
await mkdir(directory, { recursive: true });
let seed = 42;
const noise = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;

function note(frequency, start, duration, volume, metallic = false) {
  return time => {
    const t = time - start;
    if (t < 0 || t >= duration) return 0;
    const envelope = Math.min(1, t / .004) * Math.exp(-5 * t / duration) * Math.min(1, (duration - t) / .015);
    const phase = 2 * Math.PI * frequency * t;
    return volume * envelope * (Math.sin(phase) + (metallic ? .25 * Math.sin(phase * 2.76) : .12 * Math.sin(phase * 2)));
  };
}

const effects = {
  type: { duration: .065, notes: [note(520, 0, .06, .22)], click: .035 },
  delete: { duration: .075, notes: [note(330, 0, .07, .2)], click: .02 },
  guess: { duration: .25, notes: [note(523.25, 0, .16, .18), note(659.25, .07, .18, .16)] },
  invalid: { duration: .24, notes: [note(220, 0, .14, .16), note(196, .09, .15, .14)] },
  hint: { duration: .4, notes: [note(659.25, 0, .24, .18), note(987.77, .11, .29, .15)] },
  coin: { duration: .42, notes: [note(1318.51, 0, .22, .13, true), note(1760, .075, .34, .1, true)] },
  win: { duration: .95, notes: [note(523.25, 0, .3, .2), note(659.25, .12, .3, .18), note(783.99, .24, .3, .17), note(1046.5, .38, .57, .2), note(659.25, .38, .57, .08)] },
  complete: { duration: .62, notes: [note(392, 0, .32, .17), note(329.63, .16, .46, .16), note(261.63, .16, .46, .08)] },
};

for (const [name, effect] of Object.entries(effects)) {
  const frames = Math.ceil(effect.duration * sampleRate);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const click = effect.click ? effect.click * noise() * Math.exp(-t * 220) * Math.min(1, t / .002) : 0;
    const value = effect.notes.reduce((sum, tone) => sum + tone(t), click);
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2);
  }
  await writeFile(new URL(`${name}.wav`, directory), wav);
  console.log(`${name}.wav: ${frames / sampleRate}s, ${wav.length} bytes`);
}
