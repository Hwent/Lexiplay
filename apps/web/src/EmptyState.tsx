import { useTranslation } from './i18n';
import type { ReactNode } from 'react';
import Icon, { IconName } from './Icon';

export default function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children: ReactNode; action?: ReactNode }) {
  const t = useTranslation();
  return <div className="empty-state">
    <span className="feature-icon" aria-hidden="true"><Icon name={icon}/></span>
    <h3>{t(title)}</h3>
    <div className="empty-state-copy">{children}</div>
    {action && <div className="empty-state-action">{action}</div>}
  </div>;
}
