export type AutoPromote = 'off' | 'ask' | 'on';

export type ToastPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export type NotifySeverity = 'info' | 'success' | 'warning' | 'error';

export interface NotifyPrefs {
  merged: boolean;
  promotion: boolean;
  masterMerged: boolean;
  staging: boolean;
  failures: boolean;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  authors: string[];
  repos: string[];
  targetBranches: string[];
  notify: NotifyPrefs;
  autoPromote: AutoPromote;
  createdAt: string;
}

export interface RepoConfig {
  projectId: number;
  path: string;
  deployBranch: string;
  promotion: { from: string; to: string } | null;
}

export type Stage =
  | 'open'
  | 'in_develop'
  | 'promotion_open'
  | 'on_master'
  | 'done'
  | 'closed'
  | 'stale';

export type FinishedStage = 'done' | 'closed' | 'stale';

export interface PromotionMr {
  iid: number;
  webUrl: string;
  autoMergeSet: boolean;
  blockedReason?: string;
}

export interface WatchPipeline {
  id: number;
  webUrl: string;
  status: string;
}

export interface WatchLogEntry {
  at: string;
  text: string;
}

export interface Watch {
  key: string;
  projectId: number;
  projectPath: string;
  iid: number;
  title: string;
  webUrl: string;
  sourceBranch?: string;
  targetBranch: string;
  ruleId: string | null;
  notify: NotifyPrefs;
  autoPromote: AutoPromote;
  muted: boolean;
  stage: Stage;
  mergeSha?: string;
  mergedAt?: string;
  promotion?: PromotionMr;
  masterSha?: string;
  pipeline?: WatchPipeline;
  relatedPipelines?: number[];
  promoteRequested?: boolean;
  catchingUp?: boolean;
  sent: string[];
  log: WatchLogEntry[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface PipelineWatch {
  key: string;
  projectId: number;
  projectPath: string;
  pipelineId: number;
  ref: string;
  sha: string;
  title: string;
  webUrl: string;
  status: string;
  failedJobs?: string[];
  muted: boolean;
  sent: string[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface Settings {
  baseUrl: string;
  oauthClientId: string;
  pollMinutes: number;
  paused: boolean;
  desktopNotifications: boolean;
  pageToasts: boolean;
  toastPosition: ToastPosition;
  notifyNewThreads: boolean;
}

export interface FeedItem {
  id: string;
  title: string;
  message: string;
  url: string;
  severity: NotifySeverity;
  promoteKey?: string;
  at: string;
  read: boolean;
}

export type Auth =
  | { kind: 'oauth'; accessToken: string; refreshToken: string; expiresAt: number }
  | { kind: 'pat'; token: string };

export interface Me {
  id: number;
  username: string;
  name: string;
  avatarUrl: string;
}

export interface AddResult {
  key: string;
  finished: boolean;
  message: string;
}

export interface GitLabPipeline {
  id: number;
  status: string;
  ref: string;
  sha: string;
  web_url: string;
  created_at: string;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  state: 'opened' | 'closed' | 'locked' | 'merged';
  source_branch: string;
  target_branch: string;
  web_url: string;
  sha: string;
  merge_commit_sha: string | null;
  squash_commit_sha: string | null;
  draft?: boolean;
  merge_when_pipeline_succeeds?: boolean;
  detailed_merge_status?: string;
  head_pipeline?: GitLabPipeline | null;
  author: { username: string };
  references?: { full: string };
  created_at: string;
  updated_at: string;
}

export interface GitLabProject {
  id: number;
  path_with_namespace: string;
  default_branch: string;
  web_url: string;
}

export interface GitLabDiscussionNote {
  id: number;
  body: string;
  author: { username: string };
  system: boolean;
  resolvable: boolean;
  resolved?: boolean;
}

export interface GitLabDiscussion {
  id: string;
  individual_note: boolean;
  notes: GitLabDiscussionNote[];
}

export type WatchPatch = Partial<Pick<Watch, 'muted' | 'autoPromote' | 'notify'>>;
