import Icon, { IconName } from './Icon';

const destinations: { section: 'library' | 'play' | 'progress'; icon: IconName; title: string; copy: string; action: string }[] = [
  { section: 'library', icon: 'library', title: 'Find your next word', copy: 'Explore collections, discover new meanings, and make a word list of your own.', action: 'Explore the library' },
  { section: 'play', icon: 'play', title: 'Put it into practice', copy: 'A little challenge. A new discovery. Build confidence with a word puzzle.', action: 'Choose a puzzle' },
  { section: 'progress', icon: 'progress', title: 'See how far you’ve come', copy: 'Follow your activity and celebrate the words you’ve learned along the way.', action: 'View Statistics' },
];

export default function HomePage({ onNavigate }: { onNavigate: (section: 'library' | 'play' | 'progress') => void }) {
  return <section className="home-page" aria-label="Your learning home">
    <div className="home-hero">
      <div className="home-hero-copy">
        <p className="page-eyebrow">A LITTLE PRACTICE, EVERY DAY</p>
        <h2>Small steps.<br /><span>Stronger words.</span></h2>
        <p>Make space for a new word. Discover a collection, play a puzzle, and grow your English at your own pace.</p>
        <div className="home-hero-actions"><button className="primary-button" type="button" onClick={() => onNavigate('play')}>Start a puzzle <Icon name="arrow" /></button><button className="quiet-button" type="button" onClick={() => onNavigate('library')}>Explore vocabulary <Icon name="arrow" /></button></div>
      </div>
      <div className="home-word-art" aria-hidden="true">
        <div className="word-art-note"><Icon name="explore" /><span>A little discovery</span></div>
        <div className="word-art-card"><span className="word-art-label">WORD BY WORD</span><strong>grow<span>.</span></strong><span className="word-art-pos">verb</span><p>To develop, one small step at a time.</p><div className="word-art-tiles">{'GROWS'.split('').map((letter, index) => <span key={letter} data-tone={index === 2 ? 'warm' : 'green'}>{letter}</span>)}</div></div>
        <span className="word-art-caption">There’s always room to grow.</span>
      </div>
    </div>
    <div className="home-section-heading"><div><p className="page-eyebrow">MAKE IT YOURS</p><h3>A good place to begin.</h3></div><span>One word at a time.</span></div>
    <div className="learning-cards">{destinations.map((item, index) => <button type="button" key={item.section} onClick={() => onNavigate(item.section)}>
      <div className="learning-card-top"><span className={`feature-icon feature-tone-${index}`}><Icon name={item.icon} /></span><span className="learning-card-number">0{index + 1}</span></div>
      <h4>{item.title}</h4><p>{item.copy}</p><span className="learning-card-action">{item.action}<Icon name="arrow" /></span>
    </button>)}</div>
    <div className="home-note"><span className="feature-icon"><Icon name="explore" /></span><p>You don’t need to learn every word today.<br /><strong>Just find one worth keeping.</strong></p><button type="button" className="quiet-button" onClick={() => onNavigate('library')}>Find a word <Icon name="arrow" /></button></div>
  </section>;
}
