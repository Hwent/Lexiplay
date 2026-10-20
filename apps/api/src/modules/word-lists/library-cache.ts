export class LibraryCache {
  private version = '';
  private values = new Map<string, Promise<unknown>>();

  prime<T>(key: string, version: string, value: T) {
    if (version === this.version && !this.values.has(key)) this.values.set(key, Promise.resolve(value));
  }

  get<T>(key: string, version: string, load: () => Promise<T>): Promise<T> {
    if (version !== this.version) {
      this.version = version;
      this.values.clear();
    }
    const cached = this.values.get(key);
    if (cached) return cached as Promise<T>;
    const request = load().catch(error => {
      if (this.values.get(key) === request) this.values.delete(key);
      throw error;
    });
    this.values.set(key, request);
    return request;
  }
}
