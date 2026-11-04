import { useId, useState } from 'react';
import { useTranslation } from './i18n';
import Icon from './Icon';
import step1 from './assets/safari-guide/step1.jpg';
import step2 from './assets/safari-guide/step2.jpg';
import step3 from './assets/safari-guide/step3.jpg';
import step4 from './assets/safari-guide/step4.jpg';

const steps = [
  { image: step1, height: 2640, title: 'Tap More in Safari.', frame: [0, 2200, 1290, 440], highlights: [[1035, 2385, 170, 168]] },
  { image: step2, height: 2632, title: 'Tap Share.', frame: [420, 1300, 820, 950], highlights: [[510, 1360, 655, 145]] },
  { image: step3, height: 2639, title: 'Choose Add to Home Screen.', frame: [40, 1100, 1210, 600], highlights: [[90, 1495, 1110, 145]] },
  { image: step4, height: 2643, title: 'Turn on Open as Web App, then tap Add.', frame: [0, 40, 1290, 1000], highlights: [[1020, 755, 230, 112], [1010, 100, 235, 160]] },
] as const;

export default function SafariInstallGuide() {
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState(0);
  const clipId = useId();
  const step = steps[index]!;
  const [x, y, width, height] = step.frame;
  return <details className="home-install-guide" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><Icon name="share"/><span>{t('Add to Home Screen')}</span><Icon name="chevron"/></summary>
    {expanded && <div className="install-walkthrough">
      <p className="install-step-title" aria-live="polite">{t(step.title)}</p>
      <div className="install-screenshot">
        <svg key={index} viewBox={step.frame.join(' ')} role="img" aria-label={t('Step {0}: {1}', index + 1, t(step.title))}>
          <defs><clipPath id={clipId}><rect x={x} y={y} width={width} height={height}/></clipPath></defs>
          <g clipPath={`url(#${clipId})`}>
            <image href={step.image} width="1290" height={step.height}/>
            {step.highlights.map(([left, top, boxWidth, boxHeight]) => <rect key={`${left}-${top}`} x={left} y={top} width={boxWidth} height={boxHeight} className="install-highlight" vectorEffect="non-scaling-stroke"/>)}
          </g>
        </svg>
      </div>
      <div className="install-step-controls">
        <button type="button" aria-label={t('Previous step')} onClick={() => setIndex(index - 1)} disabled={index === 0}><Icon name="back"/></button>
        <span>{index + 1} / {steps.length}</span>
        <button type="button" aria-label={t('Next step')} onClick={() => setIndex(index + 1)} disabled={index === steps.length - 1}><Icon name="back"/></button>
      </div>
    </div>}
  </details>;
}
