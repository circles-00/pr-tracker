import type { PipelineWatch, Watch } from '../shared/types';
import { IndexedDb, MemoryDb, type Database, type TableDefinition } from './db';
import { storage } from './storage';

export interface HistoryDbSchema {
  mrHistory: Watch;
  pipelineHistory: PipelineWatch;
  seen: { key: string };
}

const DB_NAME = 'pr-tracker';
const DB_VERSION = 1;

const TABLES: readonly TableDefinition<keyof HistoryDbSchema>[] = [
  {
    name: 'mrHistory',
    keyPath: 'key',
    indexes: [
      { name: 'by_finishedAt', keyPath: 'finishedAt' },
      { name: 'by_target', keyPath: ['projectPath', 'iid'] },
      { name: 'by_relatedPipelines', keyPath: 'relatedPipelines', options: { multiEntry: true } },
    ],
  },
  {
    name: 'pipelineHistory',
    keyPath: 'key',
    indexes: [
      { name: 'by_finishedAt', keyPath: 'finishedAt' },
      { name: 'by_target', keyPath: ['projectPath', 'pipelineId'] },
    ],
  },
  {
    name: 'seen',
    keyPath: 'key',
  },
];

export const historyDb: Database<HistoryDbSchema> =
  typeof indexedDB !== 'undefined'
    ? new IndexedDb<HistoryDbSchema>(DB_NAME, DB_VERSION, TABLES)
    : new MemoryDb<HistoryDbSchema>(TABLES);

export async function bumpHistoryRevision(): Promise<void> {
  await storage.update('historyRevision', (n) => n + 1);
}
