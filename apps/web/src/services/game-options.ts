export type GameOptions = { wordLength: number; totalWords: number; collections: { id: string; slug: string; name: string; wordCount: number }[] };
export const GAME_OPTIONS_PATH = '/collections/game-options/all';
export const GAME_OPTIONS_LIFETIME = 300_000;
