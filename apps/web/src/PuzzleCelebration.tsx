import { CSSProperties, useEffect, useState } from 'react';

export default function PuzzleCelebration() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 2800);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <div className="puzzle-celebration" aria-hidden="true">
    <svg viewBox="0 0 600 320" preserveAspectRatio="xMidYMid slice">
      {Array.from({ length: 28 }, (_, index) => <g className="confetti-piece" key={index} style={{
        '--x': `${(index * 97 % 580) - 290}px`, '--y': `${70 + index * 31 % 230}px`,
        '--turn': `${index % 2 ? 240 : -240}deg`, animationDelay: `${index % 5 * 55}ms`,
      } as CSSProperties}>
        {index % 3 === 0 ? <circle r="5"/> : <rect x="-4" y="-7" width="8" height="14" rx="2"/>}
      </g>)}
    </svg>
  </div>;
}
