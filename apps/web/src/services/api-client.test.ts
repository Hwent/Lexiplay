import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './api-client';

describe('browser API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends JSON and session credentials while preserving caller headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'KNOWN' })));
    vi.stubGlobal('fetch', fetchMock);
    const body = JSON.stringify({ status: 'KNOWN' });
    expect(await apiRequest('/word-lists/list/words/word', {
      method: 'PATCH', body, headers: new Headers({ 'x-request-id': 'test' }),
    })).toEqual({ status: 'KNOWN' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/word-lists/list/words/word');
    expect(init).toMatchObject({ method: 'PATCH', body, credentials: 'same-origin' });
    expect(init.headers.get('content-type')).toBe('application/json');
    expect(init.headers.get('x-request-id')).toBe('test');
  });

  it('leaves multipart boundaries to the browser for uploads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const body = new FormData();
    body.append('file', new Blob(['apple']), 'words.txt');
    await apiRequest('/word-lists/list/import-preview', { method: 'POST', body });
    expect(fetchMock.mock.calls[0]![1].body).toBe(body);
    expect(fetchMock.mock.calls[0]![1].headers.has('content-type')).toBe(false);
  });

  it('accepts empty responses for logout and deletion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiRequest<void>('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('preserves HTTP status and turns validation messages into readable text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: ['term must be a string', 'definition must be shorter'],
    }), { status: 400 })));
    await expect(apiRequest('/word-lists/list/words')).rejects.toMatchObject({
      message: 'term must be a string definition must be shorter', status: 400,
    });
  });

  it('preserves unauthorized status even when an error response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })));
    const result = apiRequest('/word-lists', undefined, 'Please sign in.');
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ message: 'Please sign in.', status: 401 });
  });

  it('rejects malformed successful responses and leaves network failures visible', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('not JSON'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest('/word-lists')).rejects.toBeInstanceOf(SyntaxError);
    await expect(apiRequest('/word-lists')).rejects.toThrow('Failed to fetch');
  });
});
