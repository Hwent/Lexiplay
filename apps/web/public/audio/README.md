# Game sounds

Original LexiPlay effects, synthesized without third-party recordings or samples.
Regenerate the 24 kHz, mono, 16-bit PCM WAV files from the repository root:

```sh
node scripts/generate-game-audio.mjs
```

`type` / `delete`: puzzle input; `guess`: accepted guess; `invalid`: rejected
dictionary word; `hint`: revealed hint; `coin`: increased wallet balance;
`win`: solved puzzle; `complete`: finished puzzle with the answer revealed.

Playback starts after a browser interaction. Sound effects can be disabled in
Settings; the preference is saved on the device and does not mute pronunciation.
