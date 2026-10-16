import Icon from './Icon';

// Add another entry and its game view when a new game is ready.
export const GAME_CATALOG = [
  { id: 'word-puzzle', name: 'Word puzzle', description: 'Your collections · 3–9 letters' },
  { id: 'wordle', name: 'Original Wordle', description: 'Classic answer pool · 5 letters' },
] as const;
export default function GameCatalog({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  return <section className="game-catalog" aria-label="Available games">
    {GAME_CATALOG.map(game => <button type="button" className="game-catalog-card" key={game.id} onClick={() => onSelect(game.id)} aria-pressed={selectedId === game.id}>
      <span className="catalog-icon" aria-hidden="true"><Icon name="play" /></span><span className="catalog-copy"><strong>{game.name}</strong><span>{game.description}</span></span><span className="catalog-status">{selectedId === game.id ? <><Icon name="check" /> Selected</> : 'Play'}</span>
    </button>)}
  </section>;
}
