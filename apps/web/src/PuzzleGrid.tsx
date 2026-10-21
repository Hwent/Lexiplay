import type { ReactNode } from 'react';

export default function PuzzleGrid({ wordLength, label, children }: {
  wordLength: number; label: string; children: ReactNode;
}) {
  return <div className="guess-board" role="grid" aria-label={label} style={{
    width: `calc(${wordLength} * var(--puzzle-tile-size, 3.6rem) + ${(wordLength - 1) * .35}rem)`,
  }}>{children}</div>;
}
