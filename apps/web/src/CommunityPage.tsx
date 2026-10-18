import { useTranslation } from './i18n';
import Icon from './Icon';

export default function CommunityPage({ onExplore }: { onExplore: () => void }) {
  const t = useTranslation();
  return <section className="community-page">
    <div className="page-introduction">
      <div><p className="page-eyebrow">{t('BETTER TOGETHER')}</p><h2>{t('A shared love')}<br /><span>{t('of finding the right word.')}</span></h2><p>{t('A space for curious minds is on the way.')}</p></div>
      <span className="page-intro-icon" aria-hidden="true"><Icon name="community" /></span>
    </div>
    <div className="community-card">
      <span className="feature-icon"><Icon name="community" /></span>
      <span className="status-pill">{t('Coming together')}</span>
      <h3>{t('Good things take a little growing.')}</h3>
      <p>{t('Word-list sharing and community challenges are being planned. In the meantime, there’s a whole library to explore.')}</p>
      <button type="button" className="primary-button" onClick={onExplore}>{t('Explore vocabulary ')}<Icon name="arrow" /></button>
    </div>
  </section>;
}
