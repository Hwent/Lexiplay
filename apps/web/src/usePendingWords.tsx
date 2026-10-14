import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { PendingWords } from './services/pending-words';

export const PendingWordsContext = createContext<PendingWords | null>(null);
export function useWordSelection(store: PendingWords) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
export default function usePendingWords(listId = '') {
  const shared = useContext(PendingWordsContext);
  const store = useMemo(() => shared ?? new PendingWords(listId ? 'list:' + listId : 'guest'), [shared, listId]);
  const selection = useWordSelection(store);
  return { store, selection };
}
