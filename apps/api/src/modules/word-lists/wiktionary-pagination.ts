export function applyContinuation(
  params: URLSearchParams,
  previousKeys: string[],
  continuation: Record<string, string>,
) {
  for (const key of previousKeys) params.delete(key);
  for (const [key, value] of Object.entries(continuation)) params.set(key, value);
  return Object.keys(continuation);
}
