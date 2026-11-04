// Opt-in diagnostics: ?measure=1 enables it for this browser tab; ?measure=0 disables it.
type RequestMetric = { path: string; ms: number };
type Interaction = { sequence: number; label: string; started: number; requests: RequestMetric[]; pending: number };
let enabled = false;
let current: Interaction | undefined;
let sequence = 0;
let frame = 0;
const completed: { sequence: number; label: string; ms: number; requests: RequestMetric[] }[] = [];

export function installInteractionMetrics() {
  const setting = new URLSearchParams(location.search).get('measure');
  try {
    if (setting === '1') sessionStorage.setItem('lexiplay-measure-interactions', '1');
    if (setting === '0') sessionStorage.removeItem('lexiplay-measure-interactions');
    enabled = sessionStorage.getItem('lexiplay-measure-interactions') === '1';
  } catch { enabled = setting === '1'; }
  if (!enabled) return () => {};
  current = { sequence: ++sequence, label: 'navigation', started: 0, requests: [], pending: 0 };
  const begin = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest('button,a,input,select') : null;
    if (!target) return;
    cancelAnimationFrame(frame);
    current = { sequence: ++sequence, label: target.getAttribute('aria-label') ?? target.getAttribute('role') ?? target.tagName,
      started: performance.now(), requests: [], pending: 0 };
  };
  document.addEventListener('click', begin, true);
  document.addEventListener('input', begin, true);
  document.addEventListener('keydown', begin, true);
  const observer = new MutationObserver(recordUiCommit);
  const root = document.getElementById('root');
  if (root) observer.observe(root, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['aria-busy', 'aria-selected', 'disabled'] });
  return () => {
    enabled = false;
    current = undefined;
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener('click', begin, true);
    document.removeEventListener('input', begin, true);
    document.removeEventListener('keydown', begin, true);
  };
}

export function beginRequestMetric(path: string, mutation = false) {
  const interaction = enabled ? current : undefined;
  if (!interaction) return () => {};
  const started = performance.now();
  if (mutation) interaction.pending++;
  return () => {
    if (mutation) interaction.pending--;
    interaction.requests.push({ path: path.split('?')[0]!.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, ':id'), ms: performance.now() - started });
    if (current === interaction) recordUiCommit();
  };
}

export function recordUiCommit() {
  if (!enabled || !current) return;
  cancelAnimationFrame(frame);
  const interaction = current;
  // Wait through a paint opportunity and verify actual busy states, not a loading placeholder.
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (current !== interaction || interaction.pending || document.querySelector('#root [aria-busy="true"]')) return;
      completed.push({ sequence: interaction.sequence, label: interaction.label, ms: performance.now() - interaction.started, requests: [...interaction.requests] });
      if (completed.length > 100) completed.shift();
      document.getElementById('root')?.setAttribute('data-interaction-metrics', JSON.stringify(completed));
      current = undefined;
    });
  });
}
