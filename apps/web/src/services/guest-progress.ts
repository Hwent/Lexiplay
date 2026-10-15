import { apiRequest } from './api-client';

export const LOCAL_WORDS_KEY = 'lexiplay-local-word-lists';
export const LAST_GAME_KEY = 'lexiplay-last-game';
export const TRANSFER_KEY = 'lexiplay-progress-transfer';
type GuestWord = { term: string; definition: string; partOfSpeech: string | null; status: 'KNOWN' | 'UNFAMILIAR' };
type TransferResult = { wordsAdded: number; wordsAlreadySaved: number; gamesTransferred: number; resumeGameId: string | null };
type PendingTransfer = {
  accountId: string; source: string | null; lastGameId: string | undefined;
  batches: { id: string; words: GuestWord[] }[]; next: number; result: TransferResult;
};
let inFlight: { accountId: string; promise: Promise<TransferResult> } | undefined;

function wordsFrom(source: string | null): GuestWord[] {
  if (!source) return [];
  let lists: unknown;
  try { lists = JSON.parse(source); } catch { throw new Error('Your local word list could not be read. It has been kept on this device.'); }
  if (!Array.isArray(lists)) throw new Error('Your local word list could not be read. It has been kept on this device.');
  const words = new Map<string, GuestWord>();
  for (const list of lists) {
    if (!list || !Array.isArray(list.words)) throw new Error('Your local word list could not be read. It has been kept on this device.');
    for (const word of list.words) {
      if (!word || typeof word.term !== 'string' || typeof word.definition !== 'string' || !['KNOWN', 'UNFAMILIAR'].includes(word.status)) throw new Error('A local word could not be read. Your progress has been kept on this device.');
      const term = word.term.trim();
      if (!words.has(term)) words.set(term, { term, definition: word.definition, partOfSpeech: word.partOfSpeech ?? null, status: word.status });
    }
  }
  return [...words.values()];
}
export function hasPendingProgress() {
  try { return Boolean(window.localStorage.getItem(TRANSFER_KEY)); } catch { return false; }
}
export function forgetPendingProgress(accountId: string) {
  try {
    const source = window.localStorage.getItem(TRANSFER_KEY);
    if (source && (JSON.parse(source) as PendingTransfer).accountId === accountId) window.localStorage.removeItem(TRANSFER_KEY);
  } catch { /* Account deletion has already succeeded; keep unreadable device data. */ }
}
function snapshot(accountId: string): PendingTransfer {
  const saved = window.localStorage.getItem(TRANSFER_KEY);
  if (saved) {
    const pending = JSON.parse(saved) as PendingTransfer;
    if (pending.accountId !== accountId) throw new Error('Guest progress is waiting for another account. Sign in to that account to finish saving it.');
    return pending;
  }
  const source = window.localStorage.getItem(LOCAL_WORDS_KEY);
  const words = wordsFrom(source); const batches: PendingTransfer['batches'] = [];
  for (let offset = 0; offset < words.length; offset += 100) batches.push({ id: crypto.randomUUID(), words: words.slice(offset, offset + 100) });
  if (!batches.length) batches.push({ id: crypto.randomUUID(), words: [] });
  const latest = window.localStorage.getItem(LAST_GAME_KEY);
  const lastGameId = latest && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(latest) ? latest : undefined;
  const pending: PendingTransfer = { accountId, source, lastGameId, batches, next: 0, result: { wordsAdded: 0, wordsAlreadySaved: 0, gamesTransferred: 0, resumeGameId: null } };
  // Persist before sending, so a lost response or reload retries the same account-bound batch.
  window.localStorage.setItem(TRANSFER_KEY, JSON.stringify(pending));
  return pending;
}
function clearTransferredWords(pending: PendingTransfer) {
  const current = window.localStorage.getItem(LOCAL_WORDS_KEY);
  if (current === pending.source) { window.localStorage.removeItem(LOCAL_WORDS_KEY); return; }
  if (!current) return;
  // Another tab may have added/edited words during the transfer. Keep those changes.
  const migrated = new Set(wordsFrom(pending.source).map(word => JSON.stringify(word)));
  const lists = JSON.parse(current) as { words: GuestWord[] }[];
  for (const list of lists) list.words = list.words.filter(word => !migrated.has(JSON.stringify({ term: word.term.trim(), definition: word.definition, partOfSpeech: word.partOfSpeech ?? null, status: word.status })));
  window.localStorage.setItem(LOCAL_WORDS_KEY, JSON.stringify(lists));
}
async function transfer(accountId: string) {
  const pending = snapshot(accountId);
  while (pending.next < pending.batches.length) {
    const batch = pending.batches[pending.next]!;
    const result = await apiRequest<TransferResult>('/progress/claim', { method: 'POST', body: JSON.stringify({ accountId, transferId: batch.id, words: batch.words, lastGameId: pending.lastGameId }) });
    pending.result.wordsAdded += result.wordsAdded;
    pending.result.wordsAlreadySaved += result.wordsAlreadySaved;
    pending.result.gamesTransferred += result.gamesTransferred;
    pending.result.resumeGameId = result.resumeGameId;
    pending.next++;
    window.localStorage.setItem(TRANSFER_KEY, JSON.stringify(pending));
  }
  clearTransferredWords(pending);
  window.localStorage.removeItem(TRANSFER_KEY);
  return pending.result;
}
export function transferGuestProgress(accountId: string): Promise<TransferResult> {
  if (inFlight) return inFlight.accountId === accountId ? inFlight.promise : Promise.reject(new Error('Wait for the current account’s progress to finish saving.'));
  const promise = transfer(accountId).finally(() => { if (inFlight?.promise === promise) inFlight = undefined; });
  inFlight = { accountId, promise };
  return promise;
}
