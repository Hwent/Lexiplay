import Icon from './Icon';
import { useTranslation } from './i18n';
import './game-completion.css';

export default function NewAccountReward() {
  const t = useTranslation();
  return <div className="new-account-reward" aria-label={t('New accounts start with 100 coins.')}>
    <Icon name="coin"/>
    <div><strong>100 <span>{t('coins')}</span></strong><p>{t('Welcome reward for new accounts')}</p></div>
  </div>;
}
