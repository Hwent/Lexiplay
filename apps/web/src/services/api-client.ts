export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit, fallbackMessage = 'Something went wrong. Please try again.'): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`/api/v1${path}`, { ...init, credentials: 'same-origin', headers });
  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (response.ok) throw error;
    throw new ApiError(fallbackMessage, response.status);
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload ? payload.message : undefined;
    const text = typeof message === 'string' ? message : Array.isArray(message) ? message.filter(item => typeof item === 'string').join(' ') : '';
    const code = payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string' ? payload.code : undefined;
    throw new ApiError(text || fallbackMessage, response.status, code);
  }
  return payload as T;
}
