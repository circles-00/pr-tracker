import { DEFAULT_SETTINGS } from '../shared/constants';
import type { Auth, FeedItem, Me, PipelineWatch, RepoConfig, Rule, Settings, Watch } from '../shared/types';

export type StorageChanges<S> = {
  [K in keyof S]?: { oldValue?: S[K]; newValue?: S[K] };
};

export type StorageHydrators<S> = {
  [K in keyof S]?: (raw: unknown) => S[K];
};

export class ChromeStorage<S extends { [K in keyof S]: unknown }> {
  constructor(
    private readonly area: 'local' | 'session',
    private readonly defaults: S,
    private readonly hydrators: StorageHydrators<S> = {},
  ) {}

  private get store(): chrome.storage.StorageArea {
    return chrome.storage[this.area];
  }

  private hydrate<K extends keyof S & string>(key: K, raw: unknown): S[K] {
    if (raw === undefined) return structuredClone(this.defaults[key]);

    const hydrator = this.hydrators[key];
    return hydrator ? hydrator(raw) : (raw as S[K]);
  }

  async get<K extends keyof S & string>(key: K): Promise<S[K]> {
    const res = await this.store.get(key);
    return this.hydrate(key, res[key]);
  }

  async getMany<K extends readonly (keyof S & string)[]>(
    keys: K,
  ): Promise<{ [P in K[number]]: S[P] }> {
    const res = await this.store.get([...keys]);
    const out: Record<string, unknown> = {};

    for (const key of keys) {
      out[key] = this.hydrate(key, res[key]);
    }

    return out as { [P in K[number]]: S[P] };
  }

  async set<K extends keyof S & string>(key: K, value: S[K]): Promise<void> {
    await this.store.set({ [key]: value });
  }

  async update<K extends keyof S & string>(
    key: K,
    fn: (value: S[K]) => S[K] | void,
  ): Promise<S[K]> {
    const current = await this.get(key);
    const next = fn(current);
    const value = (next === undefined ? current : next) as S[K];

    await this.set(key, value);
    return value;
  }

  onChanged(listener: (changes: StorageChanges<S>) => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area !== this.area) return;
      listener(changes as StorageChanges<S>);
    };

    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
}

export interface StorageSchema {
  settings: Settings;
  auth: Auth | null;
  me: Me | null;
  rules: Rule[];
  repos: Record<string, RepoConfig>;
  watches: Record<string, Watch>;
  pipelineWatches: Record<string, PipelineWatch>;
  feed: FeedItem[];
  lastDiscovery: string | null;
  authError: string | null;
  uiCollapsed: boolean;
  historyRevision: number;
}

export type LocalStorageChanges = StorageChanges<StorageSchema>;

export const storage = new ChromeStorage<StorageSchema>(
  'local',
  {
    settings: DEFAULT_SETTINGS,
    auth: null,
    me: null,
    rules: [],
    repos: {},
    watches: {},
    pipelineWatches: {},
    feed: [],
    lastDiscovery: null,
    authError: null,
    uiCollapsed: false,
    historyRevision: 0,
  },
  {
    settings: (raw) => ({ ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) }),
  },
);
