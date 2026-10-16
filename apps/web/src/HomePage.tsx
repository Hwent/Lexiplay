import Icon, { IconName } from './Icon';

const destinations: { section: 'library' | 'play' | 'progress'; icon: IconName; title: string; copy: string; action: string }[] = [
  { section: 'library', icon: 'library', title: 'Vocabulary', copy: 'Browse collections and save words to your list.', action: 'Explore the library' },
  { section: 'play', icon: 'play', title: 'Games', copy: 'Choose Original Wordle or practise your vocabulary.', action: 'Choose a puzzle' },
  { section: 'progress', icon: 'progress', title: 'Statistics', copy: 'View your games, results, and practice streak.', action: 'View Statistics' },
];

export default function HomePage({ onNavigate }: { onNavigate: (section: 'library' | 'play' | 'progress') => void }) {
  return <section className="home-page" aria-label="Your learning home">
    <div className="home-hero">
      <div className="home-hero-copy">
        <p className="page-eyebrow">LEXIPLAY</p>
        <h2>Your words.<br /><span>Your next challenge.</span></h2>
        <div className="home-hero-actions"><button className="primary-button" type="button" onClick={() => onNavigate('play')}>Start a puzzle <Icon name="arrow" /></button><button className="quiet-button" type="button" onClick={() => onNavigate('library')}>Explore vocabulary <Icon name="arrow" /></button></div>
      </div>
      <div className="home-word-art" aria-hidden="true">
        <div className="word-art-note"><Icon name="explore" /></div>
        <div className="word-art-card"><span className="word-art-label">WORD BY WORD</span><strong>grow<span>.</span></strong><span className="word-art-pos">verb</span><p>To develop, one small step at a time.</p><div className="word-art-tiles">{'GROWS'.split('').map((letter, index) => <span key={letter} data-tone={index === 2 ? 'warm' : 'green'}>{letter}</span>)}</div></div>
        <svg className="word-art-orbit" viewBox="0 0 340 340"><circle cx="170" cy="170" r="156"/><path d="M280 32v24m-12-12h24M44 266v20m-10-10h20"/><circle className="orbit-dot" cx="38" cy="80" r="9"/><circle className="orbit-dot" cx="288" cy="270" r="6"/></svg>
      </div>
    </div>
    <div className="home-section-heading"><h3>Explore LexiPlay</h3></div>
    <div className="learning-cards">{destinations.map((item, index) => <button type="button" key={item.section} onClick={() => onNavigate(item.section)}>
      <div className="learning-card-top"><span className={`feature-icon feature-tone-${index}`}><Icon name={item.icon} /></span><span className="learning-card-number">0{index + 1}</span></div>
      <h4>{item.title}</h4><p>{item.copy}</p><span className="learning-card-action">{item.action}<Icon name="arrow" /></span>
    </button>)}</div>
  </section>;
}
