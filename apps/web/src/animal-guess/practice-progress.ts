import { apiRequest } from '../services/api-client';

type Completion = { roundId: string; status: 'won' | 'lost'; questionCount: number; guessCount: number; completedAt: string };
type PendingCompletion = Completion & { owner: string };
const KEY = 'lexiplay-animal-practice-pending';
let memory: PendingCompletion[] = [];
let memoryOnly = false;
const syncing = new Map<string, Promise<void>>();

function pending(): PendingCompletion[] {
  if (memoryOnly) return memory;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch { memoryOnly = true; return memory; }
}
function save(records: PendingCompletion[]) {
  memory = records;
  try { localStorage.setItem(KEY, JSON.stringify(records)); memoryOnly = false; }
  catch { memoryOnly = true; }
}

export function queueAnimalPractice(round: Completion, owner: string) {
  const records = pending();
  if (!records.some(record => record.roundId === round.roundId)) save([...records, { ...round, owner }]);
}

export function syncAnimalPractice(owner: string): Promise<void> {
  const existing = syncing.get(owner);
  if (existing) return existing;
  const task = (async () => {
    while (true) {
      const record = pending().find(item => item.owner === owner || item.owner === 'guest');
      if (!record) break;
      // Bind guest records to the first signed-in account before any retry.
      save(pending().map(item => item.roundId === record.roundId ? { ...item, owner } : item));
      const { owner: _owner, ...body } = record;
      try {
        await apiRequest('/games/animal-guess/completions', { method: 'POST', body: JSON.stringify(body) });
        save(pending().filter(item => item.roundId !== record.roundId));
      } catch { break; }
    }
  })().finally(() => { syncing.delete(owner); });
  syncing.set(owner, task);
  return task;
}
