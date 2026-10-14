import { apiRequest } from './api-client';

export class LibraryRequests {
  private values = new Map<string, { value: unknown; expiresAt: number }>();
  private pending = new Map<string, Promise<unknown>>();

  peek<T>(path: string): T | undefined {
    const cached = this.values.get(path);
    if (!cached || cached.expiresAt <= Date.now()) { this.values.delete(path); return undefined; }
    return cached.value as T;
  }
  get<T>(path: string, lifetime = 60_000): Promise<T> {
    const cached = this.peek<T>(path);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = this.pending.get(path);
    if (pending) return pending as Promise<T>;
    const request = apiRequest<T>(path).then(value => {
      if (this.pending.get(path) === request) this.prime(path, value, lifetime);
      return value;
    }).finally(() => { if (this.pending.get(path) === request) this.pending.delete(path); });
    this.pending.set(path, request);
    return request;
  }
  prime<T>(path: string, value: T, lifetime = 60_000) {
    this.values.set(path, { value, expiresAt: Date.now() + lifetime });
    while (this.values.size > 100) this.values.delete(this.values.keys().next().value!);
  }
  invalidate(prefix = '/') {
    for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key);
    for (const key of this.pending.keys()) if (key.startsWith(prefix)) this.pending.delete(key);
  }
}
