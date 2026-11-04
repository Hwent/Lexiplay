export type Section = 'home' | 'play' | 'animal-guess' | 'library' | 'dictionary' | 'feedback' | 'progress' | 'community' | 'settings' | 'licenses' | 'account';
export const sectionPaths: Record<Section, string> = {
  home: '/', play: '/games', library: '/library', dictionary: '/dictionary', progress: '/progress', community: '/community', settings: '/settings',
  licenses: '/licenses', account: '/account', feedback: '/feedback',
  'animal-guess': '/games/animal-guess',
};
