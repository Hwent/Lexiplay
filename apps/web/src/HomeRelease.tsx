const completed = [
  ['Word puzzles', '3–9 letter puzzles, difficulty options, official collections, dictionary definitions, and coin rewards for wins.'],
  ['Personal vocabulary', 'One personal word list, saved official collections, dictionary search, word imports, and learning progress.'],
  ['Accounts and progress', 'Guest practice, saving guest progress after sign-in, learning statistics, and accounts with optional email verification and password recovery.'],
];
const planned = [
  ['v0.2', 'Build a review habit', 'Spaced repetition, daily practice goals, and clearer progress trends.'],
  ['v0.3', 'Learn together', 'Opt-in word-list sharing and community challenges.'],
  ['Later', 'More ways to practise', 'Additional game modes, personalized recommendations, and broader language support.'],
];

export default function HomeRelease() {
  return <section className="home-release" aria-labelledby="release-heading">
    <div className="release-heading">
      <div><p className="eyebrow">RELEASE & MILESTONES</p><h2 id="release-heading">Growing one word at a time.</h2></div>
      <a className="github-profile" href="https://github.com/Hwent" target="_blank" rel="noopener noreferrer" aria-label="Visit Hwent on GitHub (opens in a new tab)">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.768-.244.768-.543 0-.267-.01-.975-.015-1.914-3.13.68-3.79-1.51-3.79-1.51-.512-1.3-1.25-1.646-1.25-1.646-1.023-.7.077-.686.077-.686 1.13.08 1.725 1.16 1.725 1.16 1.005 1.72 2.637 1.223 3.28.935.103-.727.393-1.223.715-1.505-2.5-.284-5.13-1.25-5.13-5.562 0-1.23.44-2.234 1.16-3.022-.116-.284-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.155a10.78 10.78 0 0 1 5.63 0c2.148-1.458 3.092-1.155 3.092-1.155.614 1.55.228 2.696.112 2.98.722.788 1.158 1.792 1.158 3.022 0 4.323-2.633 5.275-5.142 5.554.405.349.766 1.038.766 2.092 0 1.51-.014 2.728-.014 3.098 0 .302.203.652.774.542A11.25 11.25 0 0 0 12 .75Z" /></svg>
        <span>Hwent on GitHub</span><span aria-hidden="true">↗</span>
      </a>
    </div>
    <article className="release-current" aria-labelledby="current-release-heading">
      <div className="release-title"><h3 id="current-release-heading">v0.1</h3><span className="release-badge">Ready for release</span></div>
      <p>The first complete vocabulary practice experience.</p>
      <ul className="release-features">{completed.map(([title, description]) => <li key={title}><span className="milestone-check" aria-hidden="true">✓</span><div><strong>{title}</strong><p>{description}</p></div></li>)}</ul>
    </article>
    <div className="roadmap-heading"><h3>What comes next</h3><p>Planned features. Priorities may evolve with feedback.</p></div>
    <ol className="roadmap-list">{planned.map(([version, title, description]) => <li key={version}><span className="roadmap-version">{version} · Planned</span><h4>{title}</h4><p>{description}</p></li>)}</ol>
  </section>;
}
