import { useState } from 'react';
import { useTranslation } from './i18n';

export default function DefinitionText({ text }: { text: string }) {
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.length > 150;
  return <>
    <span className={`definition-text${canExpand && !expanded ? ' collapsed' : ''}`}>{text}</span>
    {canExpand && <button type="button" className="learn-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? t('Show less') : t('Learn more')}</button>}
  </>;
}
