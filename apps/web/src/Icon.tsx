import coinImage from './assets/lexi-coin.svg';

const paths = {
  home: 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8',
  play: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  library: 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5',
  dictionary: 'M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1ZM5 8h4M15 8h4M5 12h4M15 12h4',
  feedback: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5A8.5 8.5 0 0 1 9.5 3h3a8.5 8.5 0 0 1 8.5 8.5ZM7 9h9M7 13h6',
  progress: 'M4 21V10h4v11M10 21V3h4v18M16 21v-7h4v7',
  community: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  settings: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z',
  explore: 'm12 3 9 9-9 9-9-9 9-9ZM12 8v8M8 12h8',
  arrow: 'M7 17 17 7M7 7h10v10',
  back: 'M20 12H4M10 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
} as const;
export type IconName = keyof typeof paths | 'coin';
export default function Icon({ name }: { name: IconName }) {
  if (name === 'coin') return <img className="ui-icon coin-icon" src={coinImage} width="20" height="20" alt="" aria-hidden="true" draggable={false}/>;
  return <svg className="ui-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]}/></svg>;
}
