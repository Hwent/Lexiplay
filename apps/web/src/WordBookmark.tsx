import { normalizeTerm } from './dictionary-cache';
import { useTranslation } from './i18n';
import usePendingWords from './usePendingWords';

function BookmarkIcon({ added }: { added: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M6 3.75h12a1 1 0 0 1 1 1v16l-7-4.5-7 4.5v-16a1 1 0 0 1 1-1Z"
        fill={added ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function savedDefinition(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 499).trimEnd()}…` : trimmed;
}

export default function WordBookmark({
  term,
  definition,
  disabled = false,
}: {
  term: string;
  definition: string;
  disabled?: boolean;
}) {
  const t = useTranslation();
  const { store: wordStore, selection: wordSelection } = usePendingWords();
  const normalized = normalizeTerm(term);
  const saved = wordSelection.saved.has(normalized);
  const pending = wordSelection.pending.has(normalized);
  return (
    <button
      className="bookmark-button"
      type="button"
      aria-label={
        saved
          ? t('Already in word list')
          : pending
            ? t('Cancel addition of {0}', term)
            : t('Add {0} to word list', term)
      }
      aria-pressed={pending}
      title={
        saved
          ? t('Saved in word list')
          : pending
            ? t('Cancel addition')
            : t('Add to word list')
      }
      onClick={() => wordStore.toggle(term, savedDefinition(definition))}
      disabled={disabled || saved || wordSelection.saving}
    >
      <BookmarkIcon added={saved || pending} />
      <span>
        {saved ? t('Saved') : pending ? t('Cancel addition') : t('Add')}
      </span>
    </button>
  );
}
