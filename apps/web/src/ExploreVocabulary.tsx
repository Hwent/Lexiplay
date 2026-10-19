import { useTranslation } from './i18n';
import { useEffect, useState } from 'react';
import { apiRequest as api } from './services/api-client';
import { CollectionPage, VocabularyCollection } from './collection-types';
import CollectionImportDialog from './CollectionImportDialog';
import PronunciationButton from './PronunciationButton';
import Icon from './Icon';
import EmptyState from './EmptyState';
import SelectionControl from './SelectionControl';
import { collectionCache, collectionPage } from './services/collection-cache';
import usePendingWords from './usePendingWords';

type ExploreVocabularyProps = {
  signedIn: boolean;
  onImported: (id: string) => void;
  onSignIn: () => void;
  onUseCollection?: ((id: string) => void) | undefined;
};

export default function ExploreVocabulary({
  signedIn,
  onImported,
  onSignIn,
  onUseCollection,
}: ExploreVocabularyProps) {
  const t = useTranslation();
  const { store } = usePendingWords(signedIn ? 'library' : '');
  const [catalog, setCatalog] = useState<VocabularyCollection[]>(() => store.requests.peek<VocabularyCollection[]>('/collections') ?? []);
  const [slug, setSlug] = useState(
    () => new URLSearchParams(location.search).get('collection') ?? '',
  );
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CollectionPage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(() => !store.requests.peek('/collections'));
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [importing, setImporting] = useState<{
    collection: VocabularyCollection;
    ids: string[] | undefined;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<CollectionPage | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const current = data?.collection;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  useEffect(() => {
    let active = true;
    const cached = store.requests.peek<VocabularyCollection[]>('/collections');
    if (cached) { setCatalog(cached); setCatalogLoading(false); return; }
    setCatalogLoading(true);
    setError('');

    store.requests
      .get<VocabularyCollection[]>('/collections', 300_000)
      .then((rows) => {
        if (!active) return;
        if (!Array.isArray(rows)) {
          throw new Error('Could not load vocabulary collections.');
        }
        setCatalog(rows);
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Could not load collections.',
          );
        }
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });

    return () => {
      active = false;
    };
  }, [revision, store]);

  useEffect(() => {
    if (!slug) return;

    const collection = catalog.find((item) => item.slug === slug);
    if (!collection || collection.familyCount === undefined) return;

    let active = true;
    setLoading(true);
    setError('');

    collectionCache
      .load(collection)
      .then((value) => {
        if (!active) return;
        setSnapshot(value.data);
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Could not load collection.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug, catalog, revision, store]);

  useEffect(() => {
    const collection = catalog.find((item) => item.slug === slug);
    if (!collection || collection.familyCount !== undefined) return;

    let active = true;
    setLoading(true);

    const params = new URLSearchParams({
      page: String(page),
      pageSize: '25',
      view: 'families',
    });

    store.requests
      .get<CollectionPage>(`/collections/${encodeURIComponent(slug)}/words?${params}`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug, page, catalog, revision, store]);

  useEffect(() => {
    if (snapshot && snapshot.collection.slug === slug) {
      setData(collectionPage(snapshot, page, 25, savedIds));
      setLoading(false);
    }
  }, [snapshot, page, slug, savedIds]);

  useEffect(() => {
    let active = true;
    setSavedIds(new Set());

    if (!signedIn) return () => {
      active = false;
    };

    store.requests
      .get<{ entryIds?: string[] }>('/word-lists/saved-terms')
      .then((value) => {
        if (active) setSavedIds(new Set(value.entryIds ?? []));
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [signedIn, revision, store]);

  useEffect(() => {
    if (!signedIn) return;

    void store.requests
      .get<{ slug: string }[]>('/word-lists/collections')
      .then((rows) => {
        if (Array.isArray(rows)) {
          setSaved(new Set(rows.map((row) => row.slug)));
        }
      })
      .catch(() => undefined);
  }, [signedIn, store]);

  function getCollectionSize(collection: VocabularyCollection) {
    return t('{0} words', collection.wordCount.toLocaleString());
  }

  function openCollection(value: string) {
    setSlug(value);
    setData(null);
    setSnapshot(null);
    setSelected(new Set());
    setPage(1);

    const url = new URL(location.href);
    if (value) {
      url.searchParams.set('collection', value);
    } else {
      url.searchParams.delete('collection');
    }

    history.replaceState({}, '', url);
  }

  function selectMembers(ids: string[], checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);

      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }

      return next;
    });
  }

  function handlePaginationChange(nextPage: number) {
    setLoading(true);
    setPage(nextPage);
  }

  function renderWordRow(word: CollectionPage['words'][number]) {
    return (
      <tr key={word.id}>
        <td className="word-selection-cell">
        <SelectionControl
          label={t('Select {0} ({1})', word.lemma, word.partOfSpeech)}
          disabled={loading || !!word.inMyWordList}
          checked={selected.has(word.id) || !!word.inMyWordList}
          onChange={(checked) => selectMembers([word.id], checked)}
        />
        </td><td>
          <span className="word-with-pronunciation">
            <strong>{word.lemma}</strong>
            {word.inMyWordList && (
              <span className="collection-added-badge">{t('In My Word List')}</span>
            )}
            <PronunciationButton term={word.lemma} />
          </span>
          <small>{word.partOfSpeech}</small>
        </td><td><p>{word.definition ?? t('Dictionary definition not available yet.')}</p></td>
      </tr>
    );
  }

  function renderWordRows(words: CollectionPage['words']) {
    return <div className="library-table-scroll"><table className="library-data-table collection-entries-table"><thead className="sr-only"><tr><th scope="col">{t('Select')}</th><th scope="col">{t('Word')}</th><th scope="col">{t('Meaning')}</th></tr></thead><tbody>{words.map(renderWordRow)}</tbody></table></div>;
  }

  function renderPagination(position: string) {
    if (!data) return null;

    return (
      <nav className="word-pagination" aria-label={t('Collection pages {0}', t(position))}>
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => handlePaginationChange(page - 1)}
        >{t('Previous')}</button>
        <span>{t('Page {0} of {1} · {2} {3}', page, totalPages, data.total.toLocaleString(), (data.pageUnit === 'family' ? t('study units') : t('words')))}</span>
        <button
          type="button"
          disabled={page * data.pageSize >= data.total || loading}
          onClick={() => handlePaginationChange(page + 1)}
        >{t('Next')}</button>
      </nav>
    );
  }

  function renderCollectionCard(collection: VocabularyCollection) {
    const isAvailable = collection.status === 'available';

    return (
      <tr
        data-level={collection.level ?? 'exam'}
        data-available={isAvailable}
        key={collection.id}
      >
        <td><div className="collection-identity">
          <span className="collection-level-mark" aria-hidden="true">
            {collection.level ?? t('Aa')}
          </span>
        <div className="collection-card-heading">
          <h3>{collection.name}</h3>
        </div>
        </div></td>
        <td className="collection-word-count">{isAvailable ? collection.wordCount.toLocaleString() : t('Coming soon')}</td>
        <td className="table-action-cell">
        <button
          type="button"
          className="account-action"
          aria-label={t('Explore {0}', collection.name)}
          disabled={!isAvailable}
          onClick={() => openCollection(collection.slug)}
        >
          {isAvailable ? (
            <>{t('Explore ')}<Icon name="arrow" />
            </>
          ) : (
            'Coming soon'
          )}
        </button>
        </td>
      </tr>
    );
  }

  return (
    <section className="explore-vocabulary" aria-label={t('Explore Vocabulary')} aria-busy={(slug ? loading : catalogLoading) || saving}>
      {!slug ? (
        <>
          <div className="library-section-heading">
            <div>
              <h2>{t('Find your next collection')}</h2>
            </div>
          </div>

          {!catalogLoading && !error && !catalog.length && <EmptyState icon="library" title={t('More words are on the way.')} action={<a className="primary-button" href="/dictionary">{t('Find words ')}<Icon name="arrow"/></a>}><p>{t('There are no collections to explore yet. Discover a word in Dictionary to get started.')}</p></EmptyState>}
          {!!catalog.length && <div className="library-table-scroll">
            <table className="library-data-table collection-catalog-table" aria-label={t('Vocabulary collections')}><thead><tr><th scope="col">{t('Collection')}</th><th scope="col">{t('Words')}</th><th scope="col"><span className="sr-only">{t('Explore')}</span></th></tr></thead><tbody>{catalog.map(renderCollectionCard)}</tbody></table>
          </div>}
        </>
      ) : (
        <>
          <button
            type="button"
            className="text-action library-back"
            onClick={() => openCollection('')}
          >
            <Icon name="back" />{t(' All collections')}</button>

          {current && (
            <>
              <header className="collection-detail-heading">
                <span className="collection-level-mark" aria-hidden="true">
                  {current.level ?? t('Aa')}
                </span>
                <div>
                  <h2>{current.name}</h2>
                </div>
                <span className="library-count">{getCollectionSize(current)}</span>
              </header>

              <div className="collection-bulk-actions">
                <button
                  type="button"
                  className="account-action"
                  disabled={loading || saving || saved.has(current.slug)}
                  onClick={() => {
                    if (!signedIn) {
                      onSignIn();
                      return;
                    }

                    setSaving(true);
                    void api(`/collections/${current.slug}/save`, { method: 'POST' })
                      .then(() => {
                        store.requests.invalidate('/word-lists/collections');
                        store.invalidateWords();
                        void store.loadSaved(true).then(() => setRevision(value => value + 1)).catch(() => {});
                        setSaved((values) => new Set([...values, current.slug]));
                      })
                      .catch((requestError) => {
                        setError(
                          requestError instanceof Error
                            ? requestError.message
                            : 'Could not save collection.',
                        );
                      })
                      .finally(() => setSaving(false));
                  }}
                >
                  {saved.has(current.slug) ? t('Collection saved') : t('Save collection')}
                </button>

                <button
                  type="button"
                  disabled={!selected.size || loading}
                  onClick={() => setImporting({ collection: current, ids: [...selected] })}
                >{t('Add to My Word List ({0})', selected.size)}</button>

                <button
                  type="button"
                  disabled={!selected.size}
                  onClick={() => setSelected(new Set())}
                >{t('Clear selection')}</button>
              </div>

              <div className="collection-local-actions">

                {snapshot && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setLoading(true);
                      setError('');

                      void collectionCache
                        .load(current, true)
                        .then((value) => {
                          setSnapshot(value.data);
                        })
                        .catch((requestError) => setError(requestError.message))
                        .finally(() => setLoading(false));
                    }}
                  >{t('Refresh local copy')}</button>
                )}

                {onUseCollection && current.status === 'available' && (
                  <button
                    type="button"
                    onClick={() => onUseCollection(current.slug)}
                  >
                    <Icon name="play" />{t(' Use collection in game')}</button>
                )}
              </div>

              {renderPagination('top')}

              {!loading && data && (
                <>
                  <div className="collection-selection-summary">
                    <SelectionControl
                      label={t('Select available words on this page')}
                      disabled={loading || !data.words.some((word) => !word.inMyWordList)}
                      checked={
                        data.words.length > 0 &&
                        data.words.every(
                          (word) => word.inMyWordList || selected.has(word.id),
                        )
                      }
                      onChange={(checked) =>
                        selectMembers(
                          data.words
                            .filter((word) => !word.inMyWordList)
                            .map((word) => word.id),
                          checked,
                        )
                      }
                    >{t('Select this page')}</SelectionControl>
                  </div>

                  {data.families ? (
                    <div className="collection-family-cards">
                      {data.families.map((family) => {
                        const members = data.words.filter((word) =>
                          family.memberIds.includes(word.id),
                        );
                        const available = members.filter((word) => !word.inMyWordList);

                        return (
                          <article
                            className="collection-family-card"
                            key={family.id}
                            aria-label={`${family.headword} ${t(family.kind === 'family' ? 'word family' : 'study item')}`}
                          >
                            <header>
                              <div>
                                <h3>{family.headword}</h3>
                              </div>

                              <SelectionControl
                                label={t('Select {0} {1}', family.headword, (family.kind === 'family' ? t('family members') : t('item')))}
                                disabled={!available.length || loading}
                                checked={
                                  members.length > 0 &&
                                  members.every(
                                    (word) => word.inMyWordList || selected.has(word.id),
                                  )
                                }
                                onChange={(checked) =>
                                  selectMembers(
                                    available.map((word) => word.id),
                                    checked,
                                  )
                                }
                              >
                                {family.kind === 'family' ? t('Select family') : t('Select item')}
                              </SelectionControl>
                            </header>

                            {renderWordRows(members)}

                            {family.relatedMembers.length > 0 && (
                              <details className="family-related">
                                <summary>{t('Related members at other levels ({0})', family.relatedMembers.length)}</summary>

                                <div>
                                  {[...new Set(family.relatedMembers.map((word) => word.level))]
                                    .sort()
                                    .map((level) => (
                                      <section key={level}>
                                        <h4>{t('{0} collection', level)}</h4>
                                        <ul>
                                          {family.relatedMembers
                                            .filter((word) => word.level === level)
                                            .map((word) => (
                                              <li
                                                key={`${word.lemma}-${word.partsOfSpeech.join('-')}`}
                                              >
                                                <strong>{word.lemma}</strong>
                                                <span>{word.partsOfSpeech.join(', ')}</span>
                                              </li>
                                            ))}
                                        </ul>
                                      </section>
                                    ))}
                                </div>

                                <p>{t('Each member keeps its own level and learning progress.')}</p>
                              </details>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    renderWordRows(data.words)
                  )}

                  {!data.words.length && <p>{t('No words in this collection.')}</p>}
                </>
              )}

              {renderPagination('bottom')}
            </>
          )}
        </>
      )}

      {error && (
        <p role="alert">
          {t(error)}{' '}
          <button type="button" onClick={() => setRevision((value) => value + 1)}>{t('Retry')}</button>
        </p>
      )}

      {importing && (
        <CollectionImportDialog
          collection={importing.collection}
          selectedIds={importing.ids}
          signedIn={signedIn}
          onSignIn={onSignIn}
          onAdded={() => {
            setSelected(new Set());
            setRevision((value) => value + 1);
          }}
          onClose={() => setImporting(null)}
          onImported={(id) => {
            setImporting(null);
            onImported(id);
          }}
        />
      )}
    </section>
  );
}
