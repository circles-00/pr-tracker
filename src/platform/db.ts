export interface IndexDefinition {
  name: string;
  keyPath: string | readonly string[];
  options?: IDBIndexParameters;
}

export interface TableDefinition<K extends string = string> {
  name: K;
  keyPath: string;
  indexes?: readonly IndexDefinition[];
}

export interface Table<T> {
  get(key: IDBValidKey): Promise<T | undefined>;
  has(key: IDBValidKey): Promise<boolean>;
  put(value: T): Promise<void>;
  putMany(values: readonly T[]): Promise<void>;
  delete(key: IDBValidKey): Promise<void>;
  findByIndex(indexName: string, query: IDBValidKey): Promise<T | undefined>;
  findAllByIndex(indexName: string, query?: IDBValidKey): Promise<T[]>;
  recent(indexName: string, limit?: number): Promise<T[]>;
}

export interface Database<S extends { [K in keyof S]: unknown }> {
  table<K extends keyof S & string>(name: K): Table<S[K]>;
}

function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function wrapTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

class IndexedDbTable<T> implements Table<T> {
  constructor(
    private readonly openDb: () => Promise<IDBDatabase>,
    private readonly storeName: string,
  ) {}

  async get(key: IDBValidKey): Promise<T | undefined> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    return wrapRequest(tx.objectStore(this.storeName).get(key) as IDBRequest<T | undefined>);
  }

  async has(key: IDBValidKey): Promise<boolean> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const count = await wrapRequest(tx.objectStore(this.storeName).count(key));
    return count > 0;
  }

  async put(value: T): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).put(value);
    await wrapTransaction(tx);
  }

  async putMany(values: readonly T[]): Promise<void> {
    if (values.length === 0) return;

    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);

    for (const value of values) store.put(value);

    await wrapTransaction(tx);
  }

  async delete(key: IDBValidKey): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).delete(key);
    await wrapTransaction(tx);
  }

  async findByIndex(indexName: string, query: IDBValidKey): Promise<T | undefined> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const index = tx.objectStore(this.storeName).index(indexName);
    return wrapRequest(index.get(query) as IDBRequest<T | undefined>);
  }

  async findAllByIndex(indexName: string, query?: IDBValidKey): Promise<T[]> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const index = tx.objectStore(this.storeName).index(indexName);
    return wrapRequest(index.getAll(query) as IDBRequest<T[]>);
  }

  async recent(indexName: string, limit?: number): Promise<T[]> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const index = tx.objectStore(this.storeName).index(indexName);

    return new Promise<T[]>((resolve, reject) => {
      const results: T[] = [];
      const request = index.openCursor(null, 'prev');

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || (limit !== undefined && results.length >= limit)) {
          resolve(results);
          return;
        }

        results.push(cursor.value as T);
        cursor.continue();
      };

      request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
    });
  }
}

export class IndexedDb<S extends { [K in keyof S]: unknown }> implements Database<S> {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly tables = new Map<string, Table<unknown>>();

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly definitions: readonly TableDefinition<keyof S & string>[],
  ) {}

  table<K extends keyof S & string>(name: K): Table<S[K]> {
    let existing = this.tables.get(name);
    if (!existing) {
      existing = new IndexedDbTable<S[K]>(() => this.open(), name);
      this.tables.set(name, existing);
    }

    return existing as Table<S[K]>;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.name, this.version);

      request.onupgradeneeded = () => {
        const db = request.result;

        for (const def of this.definitions) {
          const store = db.objectStoreNames.contains(def.name)
            ? request.transaction!.objectStore(def.name)
            : db.createObjectStore(def.name, { keyPath: def.keyPath });

          for (const idx of def.indexes ?? []) {
            if (!store.indexNames.contains(idx.name)) {
              store.createIndex(idx.name, idx.keyPath as string | string[], idx.options);
            }
          }
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };

        resolve(db);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error ?? new Error(`Failed to open IndexedDB "${this.name}"`));
      };
    });

    return this.dbPromise;
  }
}

function readKeyPath(record: unknown, keyPath: string | readonly string[]): unknown {
  const obj = record as Record<string, unknown>;
  if (typeof keyPath === 'string') return obj[keyPath];

  return keyPath.map((k) => obj[k]);
}

function keyMatches(value: unknown, query: IDBValidKey, multiEntry?: boolean): boolean {
  if (multiEntry && Array.isArray(value)) {
    return value.some((item) => keyMatches(item, query, false));
  }

  if (Array.isArray(value) && Array.isArray(query)) {
    return value.length === query.length && value.every((v, i) => v === query[i]);
  }

  return value === query;
}

class MemoryTable<T> implements Table<T> {
  private readonly rows = new Map<string, T>();

  constructor(private readonly def: TableDefinition) {}

  async get(key: IDBValidKey): Promise<T | undefined> {
    const item = this.rows.get(String(key));
    return item === undefined ? undefined : structuredClone(item);
  }

  async has(key: IDBValidKey): Promise<boolean> {
    return this.rows.has(String(key));
  }

  async put(value: T): Promise<void> {
    const key = readKeyPath(value, this.def.keyPath) as IDBValidKey;
    this.rows.set(String(key), structuredClone(value));
  }

  async putMany(values: readonly T[]): Promise<void> {
    for (const value of values) {
      const key = readKeyPath(value, this.def.keyPath) as IDBValidKey;
      this.rows.set(String(key), structuredClone(value));
    }
  }

  async delete(key: IDBValidKey): Promise<void> {
    this.rows.delete(String(key));
  }

  async findByIndex(indexName: string, query: IDBValidKey): Promise<T | undefined> {
    const idx = this.getIndex(indexName);

    for (const item of this.rows.values()) {
      if (keyMatches(readKeyPath(item, idx.keyPath), query, idx.options?.multiEntry)) {
        return structuredClone(item);
      }
    }

    return undefined;
  }

  async findAllByIndex(indexName: string, query?: IDBValidKey): Promise<T[]> {
    const idx = this.getIndex(indexName);
    const out: T[] = [];

    for (const item of this.rows.values()) {
      if (query === undefined || keyMatches(readKeyPath(item, idx.keyPath), query, idx.options?.multiEntry)) {
        out.push(structuredClone(item));
      }
    }

    return out;
  }

  async recent(indexName: string, limit?: number): Promise<T[]> {
    const idx = this.getIndex(indexName);
    const sorted = [...this.rows.values()].sort((a, b) => {
      const ka = String(readKeyPath(a, idx.keyPath) ?? '');
      const kb = String(readKeyPath(b, idx.keyPath) ?? '');
      return kb.localeCompare(ka);
    });

    const sliced = limit !== undefined ? sorted.slice(0, limit) : sorted;
    return sliced.map((item) => structuredClone(item));
  }

  private getIndex(indexName: string): IndexDefinition {
    const idx = this.def.indexes?.find((i) => i.name === indexName);
    if (!idx) throw new Error(`Unknown index "${indexName}" on "${this.def.name}"`);

    return idx;
  }
}

export class MemoryDb<S extends { [K in keyof S]: unknown }> implements Database<S> {
  private readonly tables = new Map<string, Table<unknown>>();

  constructor(definitions: readonly TableDefinition<keyof S & string>[]) {
    for (const def of definitions) {
      this.tables.set(def.name, new MemoryTable(def));
    }
  }

  table<K extends keyof S & string>(name: K): Table<S[K]> {
    const table = this.tables.get(name);
    if (!table) throw new Error(`Unknown table "${name}"`);

    return table as Table<S[K]>;
  }
}
