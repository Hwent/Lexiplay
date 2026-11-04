import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { beginRequestMetric, installInteractionMetrics, recordUiCommit } from './interaction-metrics';

let cleanup: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  history.replaceState({}, '', '/?measure=1');
  document.body.innerHTML = '<div id="root"><button aria-label="Test operation">Run</button><section aria-busy="true"></section></div>';
  cleanup = installInteractionMetrics();
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; sessionStorage.clear(); vi.useRealTimers(); history.replaceState({}, '', '/'); });
const metrics = () => JSON.parse(document.getElementById('root')!.getAttribute('data-interaction-metrics') ?? '[]');

it('waits for the mutation response and actual busy state before measuring completion', async () => {
  document.querySelector('button')!.click();
  const finish = beginRequestMetric('/games/123e4567-e89b-12d3-a456-426614174000/hints', true);
  recordUiCommit();
  await vi.advanceTimersByTimeAsync(50);
  expect(metrics()).toEqual([]);
  document.querySelector('section')!.setAttribute('aria-busy', 'false');
  recordUiCommit();
  await vi.advanceTimersByTimeAsync(50);
  expect(metrics()).toEqual([]);
  finish();
  await vi.advanceTimersByTimeAsync(50);
  expect(metrics().at(-1)).toMatchObject({ label: 'Test operation', requests: [{ path: '/games/:id/hints' }] });
});

it('does not wait for an unrelated background read when cached content is already visible', async () => {
  document.querySelector('section')!.setAttribute('aria-busy', 'false');
  document.querySelector('button')!.click();
  const finish = beginRequestMetric('/library/revision');
  recordUiCommit();
  await vi.advanceTimersByTimeAsync(50);
  expect(metrics().at(-1)).toMatchObject({ label: 'Test operation', requests: [] });
  finish();
});

it('produces no diagnostics when explicitly disabled', async () => {
  cleanup();
  history.replaceState({}, '', '/?measure=0');
  cleanup = installInteractionMetrics();
  document.querySelector('button')!.click();
  recordUiCommit();
  await vi.advanceTimersByTimeAsync(50);
  expect(metrics()).toEqual([]);
});
