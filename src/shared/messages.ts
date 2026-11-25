import type { Target } from './target';
import type {
  AddResult,
  Me,
  PipelineWatch,
  RepoConfig,
  Rule,
  Settings,
  Watch,
  WatchPatch,
} from './types';

export interface MessageMap {
  status: { req: { target: Target }; res: Watch | PipelineWatch | null };
  watch: { req: { target: Target }; res: AddResult };
  unwatch: { req: { key: string }; res: void };
  promote: { req: { key: string }; res: boolean };
  readFeed: { req: { ids?: string[] }; res: void };
  isExpectingToken: { req: Record<never, never>; res: boolean };
  signInToken: { req: { token: string }; res: Me };
  setUiCollapsed: { req: { collapsed: boolean }; res: void };

  mutePipeline: { req: { key: string; muted: boolean }; res: void };
  patchWatch: { req: { key: string; patch: WatchPatch }; res: void };
  tick: { req: Record<never, never>; res: void };
  signInOAuth: { req: Record<never, never>; res: Me };
  signOut: { req: Record<never, never>; res: void };
  expectToken: { req: Record<never, never>; res: boolean };
  updateSettings: { req: { patch: Partial<Settings> }; res: Settings };
  saveRule: { req: { rule: Rule }; res: Rule[] };
  deleteRule: { req: { id: string }; res: Rule[] };
  saveRepo: { req: { repo: RepoConfig }; res: Record<string, RepoConfig> };
  deleteRepo: { req: { projectId: number }; res: Record<string, RepoConfig> };
  getHistory: { req: { limit?: number }; res: { mrs: Watch[]; pipelines: PipelineWatch[] } };
  testToast: { req: Record<never, never>; res: void };
}

export type MessageType = keyof MessageMap;

export type RequestMessage<K extends MessageType = MessageType> = {
  [T in K]: { type: T } & MessageMap[T]['req'];
}[K];

export type ResponseEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

export const CONTENT_ALLOWED_MESSAGES: ReadonlySet<MessageType> = new Set<MessageType>([
  'status',
  'watch',
  'unwatch',
  'promote',
  'readFeed',
  'isExpectingToken',
  'signInToken',
  'setUiCollapsed',
]);
