import { useEffect, useState } from 'react';
import { apiRequest as api } from './services/api-client';
import { CollectionPage, VocabularyCollection } from './collection-types';
import CollectionImportDialog from './CollectionImportDialog';
import PronunciationButton from './PronunciationButton';
import Icon from './Icon';
import SelectionControl from './SelectionControl';
import { collectionCache, collectionPage } from './services/collection-cache';
import usePendingWords from './usePendingWords';

type ExploreVocabularyProps = {
  signedIn: boolean;
  onImported: (id: string) => void;
  onSignIn: () => void;
  onUseCollection?: ((id: string) => void) | undefined;
};

const CEFR_DESCRIPTIONS: Record<string, string> = {
  A1: 'Everyday English foundations',
  A2: 'Build confidence in everyday conversations',
  B1: 'Communicate about familiar topics',
  B2: 'Express ideas with greater confidence',
  C1: 'Understand and use complex English',
  C2: 'Master subtle meanings and nuance',
};

export default function ExploreVocabulary({
  signedIn,
  onImported,
  onSignIn,
  onUseCollection,
}: ExploreVocabularyProps) {
  const { store } = usePendingWords(signedIn ? 'library' : '');
  const [catalog, setCatalog] = useState<VocabularyCollection[]>([]);
  const [slug, setSlug] = useState(
    () => new URLSearchParams(location.search).get('collection') ?? '',
  );
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CollectionPage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [importing, setImporting] = useState<{
    collection: VocabularyCollection;
    ids: string[] | undefined;
  } | null>(null);
  const [localStatus, setLocalStatus] = useState('');
  const [snapshot, setSnapshot] = useState<CollectionPage | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const current = data?.collection;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  useEffect(() => {
    let active = true;
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
        setLocalStatus(
          value.stored ? 'Saved on this device' : 'Available for this visit',
        );
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

  function getCollectionDescription(collection: VocabularyCollection) {
    if (collection.level === 'C2' && collection.status === 'available') {
      return collection.description;
    }

    if (collection.category === 'CEFR' && collection.level) {
      return CEFR_DESCRIPTIONS[collection.level] ?? '';
    }

    return collection.status === 'available' ? collection.description : 'Coming soon';
  }

  function getCollectionSize(collection: VocabularyCollection) {
    if (collection.familyCount === undefined) {
      return `${collection.wordCount.toLocaleString()} words`;
    }

    const membersSummary = `${collection.familyCount.toLocaleString()} families · ${collection.wordCount.toLocaleString()} members`;
    return collection.otherUnitCount
      ? `${membersSummary} · ${collection.otherUnitCount} other items`
      : membersSummary;
  }

  function openCollection(value: string) {
    setSlug(value);
    setData(null);
    setSnapshot(null);
    setLocalStatus('');
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
      <li key={word.id}>
        <SelectionControl
          label={`Select ${word.lemma} (${word.partOfSpeech})`}
          disabled={loading || !!word.inMyWordList}
          checked={selected.has(word.id) || !!word.inMyWordList}
          onChange={(checked) => selectMembers([word.id], checked)}
        />
        <div>
          <span className="word-with-pronunciation">
            <strong>{word.lemma}</strong>
            {word.inMyWordList && (
              <span className="collection-added-badge">In My Word List</span>
            )}
            <PronunciationButton term={word.lemma} />
          </span>
          <small>{word.partOfSpeech}</small>
          <p>{word.definition ?? 'Dictionary definition not available yet.'}</p>
        </div>
      </li>
    );
  }

  function renderWordRows(words: CollectionPage['words']) {
    return <ul className="collection-word-rows">{words.map(renderWordRow)}</ul>;
  }

  function renderPagination(position: string) {
    if (!data) return null;

    return (
      <nav className="word-pagination" aria-label={`Collection pages ${position}`}>
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => handlePaginationChange(page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages} · {data.total.toLocaleString()} {data.pageUnit === 'family' ? 'study units' : 'words'}
        </span>
        <button
          type="button"
          disabled={page * data.pageSize >= data.total || loading}
          onClick={() => handlePaginationChange(page + 1)}
        >
          Next
        </button>
      </nav>
    );
  }

  function renderCollectionCard(collection: VocabularyCollection) {
    const isAvailable = collection.status === 'available';

    return (
      <article
        className="vocabulary-collection-card"
        data-level={collection.level ?? 'exam'}
        data-available={isAvailable}
        key={collection.id}
      >
        <div className="collection-card-top">
          <span className="collection-level-mark" aria-hidden="true">
            {collection.level ?? 'Aa'}
          </span>
          <span className="collection-category-label">
            {collection.category === 'CEFR' ? 'GENERAL ENGLISH' : 'EXAM PREPARATION'}
          </span>
        </div>

        <div className="collection-card-heading">
          <h3>{collection.name}</h3>
          <span className="collection-saved-badge">
            {saved.has(collection.slug) ? 'Saved' : ''}
          </span>
        </div>

        <p>{getCollectionDescription(collection)}</p>
        <small>{isAvailable ? getCollectionSize(collection) : 'Coming soon'}</small>

        <button
          type="button"
          className="account-action"
          aria-label={`Explore ${collection.name}`}
          disabled={!isAvailable}
          onClick={() => openCollection(collection.slug)}
        >
          {isAvailable ? (
            <>
              Explore collection <Icon name="arrow" />
            </>
          ) : (
            'Coming soon'
          )}
        </button>
      </article>
    );
  }

  return (
    <section className="explore-vocabulary" aria-label="Explore Vocabulary">
      {!slug ? (
        <>
          <div className="library-section-heading">
            <div>
              <h2>Find your next collection</h2>
              <p className="collection-intro">
                Discover word collections for your learning goals.
              </p>
            </div>
            {!catalogLoading && (
              <span className="library-count">
                {catalog.filter((collection) => collection.status === 'available').length}{' '}
                ready to explore
              </span>
            )}
          </div>

          <div className="vocabulary-collection-grid">
            {catalog.map(renderCollectionCard)}
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className="text-action library-back"
            onClick={() => openCollection('')}
          >
            <Icon name="back" /> All collections
          </button>

          {current && (
            <>
              <header className="collection-detail-heading">
                <span className="collection-level-mark" aria-hidden="true">
                  {current.level ?? 'Aa'}
                </span>
                <div>
                  <p className="library-eyebrow">VOCABULARY COLLECTION</p>
                  <h2>{current.name}</h2>
                  <p>{getCollectionDescription(current)}</p>
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
                  {saved.has(current.slug)
                    ? 'Collection saved'
                    : saving
                      ? 'Saving…'
                      : 'Save collection'}
                </button>

                <button
                  type="button"
                  disabled={!selected.size || loading}
                  onClick={() => setImporting({ collection: current, ids: [...selected] })}
                >
                  Add to My Word List ({selected.size})
                </button>

                <button
                  type="button"
                  disabled={!selected.size}
                  onClick={() => setSelected(new Set())}
                >
                  Clear selection
                </button>
              </div>

              <div className="collection-local-actions">
                <span role="status">{localStatus}</span>

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
                          setLocalStatus(
                            value.stored ? 'Saved on this device' : 'Available for this visit',
                          );
                        })
                        .catch((requestError) => setError(requestError.message))
                        .finally(() => setLoading(false));
                    }}
                  >
                    Refresh local copy
                  </button>
                )}

                {onUseCollection && current.status === 'available' && (
                  <button
                    type="button"
                    onClick={() => onUseCollection(current.slug)}
                  >
                    <Icon name="play" /> Use collection in game
                  </button>
                )}
              </div>

              {renderPagination('top')}

              {!loading && data && (
                <>
                  <div className="collection-selection-summary">
                    <SelectionControl
                      label="Select available words on this page"
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
                    >
                      Select this page
                    </SelectionControl>
                    <span role="status">{selected.size} selected across pages</span>
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
                            aria-label={`${family.headword} ${family.kind === 'family' ? 'word family' : 'study item'}`}
                          >
                            <header>
                              <div>
                                <p className="library-eyebrow">
                                  {family.kind === 'family'
                                    ? 'WORD FAMILY'
                                    : family.kind === 'phrase'
                                      ? 'PHRASE'
                                      : 'INDIVIDUAL WORD'}
                                </p>
                                <h3>{family.headword}</h3>
                              </div>

                              <SelectionControl
                                label={`Select ${family.headword} ${family.kind === 'family' ? 'family members' : 'item'}`}
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
                                {family.kind === 'family' ? 'Select family' : 'Select item'}
                              </SelectionControl>
                            </header>

                            {renderWordRows(members)}

                            {family.relatedMembers.length > 0 && (
                              <details className="family-related">
                                <summary>
                                  Related members at other levels ({family.relatedMembers.length})
                                </summary>

                                <div>
                                  {[...new Set(family.relatedMembers.map((word) => word.level))]
                                    .sort()
                                    .map((level) => (
                                      <section key={level}>
                                        <h4>{level} collection</h4>
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

                                <p>Each member keeps its own level and learning progress.</p>
                              </details>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    renderWordRows(data.words)
                  )}

                  {!data.words.length && <p>No words in this collection.</p>}
                </>
              )}

              {renderPagination('bottom')}
            </>
          )}
        </>
      )}

      {(slug ? loading : catalogLoading) && (
        <p className="library-loading" role="status">
          Loading vocabulary…
        </p>
      )}

      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            Retry
          </button>
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
