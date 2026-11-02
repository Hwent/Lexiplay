import type { Game, HintType } from './game-types';
import { useTranslation } from './i18n';
import { definitionHintText } from './hint-text';
import Icon from './Icon';

type Props = {
  game: Game | null;
  finished: boolean | undefined;
  busy: boolean;
  progressSaving: boolean;
  type: HintType;
  onUse: (type: HintType) => Promise<void>;
};

export default function PuzzleHint({
  game,
  finished,
  busy,
  progressSaving,
  type,
  onUse,
}: Props) {
  const t = useTranslation();
  if (!game || finished) return null;
  const title = type === 'nextWord' ? 'Auto-fill a word' : 'Definition';
  const clue = game.clues?.[type];
  const revealed = !!clue && type === 'definition';
  return (
    <aside
      className={`puzzle-hint hint-${type}`}
      aria-label={t('{0} hint', t(title))}
    >
      <button
        className="friendly-hint"
        type="button"
        aria-label={t(
          '{0} hint · {1}',
          t(title),
          clue ? t(revealed ? 'Revealed' : 'Fill word') : t('1 coin'),
        )}
        onClick={() => void onUse(type)}
        disabled={
          busy ||
          progressSaving ||
          revealed ||
          (!clue && game.hints[type] === 0)
        }
      >
        <span className="hint-icon" aria-hidden="true">
          <Icon name="library" />
        </span>
        <strong>{t(title)}</strong>
        <span className="hint-price">
          {clue ? (
            <Icon name="check" />
          ) : (
            <>
              <Icon name="coin" />1
            </>
          )}
        </span>
      </button>
      {revealed && <p className="hint-clue">{definitionHintText(clue)}</p>}
    </aside>
  );
}
