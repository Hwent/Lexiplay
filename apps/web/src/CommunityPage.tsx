import Icon from './Icon';

export default function CommunityPage({ onExplore }: { onExplore: () => void }) {
  return <section className="community-page">
    <div className="page-introduction">
      <div><p className="page-eyebrow">BETTER TOGETHER</p><h2>A shared love<br /><span>of finding the right word.</span></h2><p>A space for curious minds is on the way.</p></div>
      <span className="page-intro-icon" aria-hidden="true"><Icon name="community" /></span>
    </div>
    <div className="community-card">
      <span className="feature-icon"><Icon name="community" /></span>
      <span className="status-pill">Coming together</span>
      <h3>Good things take a little growing.</h3>
      <p>Word-list sharing and community challenges are being planned. In the meantime, there’s a whole library to explore.</p>
      <button type="button" className="primary-button" onClick={onExplore}>Explore vocabulary <Icon name="arrow" /></button>
    </div>
  </section>;
}
