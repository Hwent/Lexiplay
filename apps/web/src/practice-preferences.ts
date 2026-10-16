export type PracticePreferences = {
  wordLength: number;
  difficulty: 'easy' | 'medium' | 'hard';
  collectionId: string;
  playWithMyWords: boolean;
};

const KEY = 'lexiplay-practice-preferences';
const defaults: PracticePreferences = { wordLength: 5, difficulty: 'medium', collectionId: '', playWithMyWords: false };

export function readPracticePreferences(): PracticePreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved) return defaults;
    return {
      wordLength: Number.isInteger(saved.wordLength) && saved.wordLength >= 3 && saved.wordLength <= 9 ? saved.wordLength : defaults.wordLength,
      difficulty: ['easy', 'medium', 'hard'].includes(saved.difficulty) ? saved.difficulty : defaults.difficulty,
      collectionId: typeof saved.collectionId === 'string' ? saved.collectionId : '',
      playWithMyWords: saved.playWithMyWords === true,
    };
  } catch { return defaults; }
}

export function savePracticePreferences(value: PracticePreferences) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Preferences remain available for this visit. */ }
}
