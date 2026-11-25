import type { NotifyPrefs, Settings, Stage } from './types';

export const DEFAULT_NOTIFY: NotifyPrefs = {
  merged: true,
  promotion: true,
  masterMerged: true,
  staging: true,
  failures: true,
};

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://gitlab.com',
  oauthClientId: '',
  pollMinutes: 1,
  paused: false,
  desktopNotifications: true,
  pageToasts: true,
  toastPosition: 'bottom-right',
};

export const POLL_ALARM_NAME = 'poll';
export const SELF_HOSTED_SCRIPT_ID = 'self-hosted';

export const FEED_LIMIT = 50;
export const STALE_AFTER_MS = 7 * 24 * 3600_000;
export const EXPECT_TOKEN_TTL_MS = 15 * 60_000;
export const TOAST_DURATION_MS = 12_000;

export const FINISHED_STAGES: ReadonlySet<Stage> = new Set<Stage>(['done', 'closed', 'stale']);
export const FINISHED_PIPELINE_STATUSES: ReadonlySet<string> = new Set(['success', 'failed', 'canceled', 'skipped']);
export const FAILED_PIPELINE_STATUSES: ReadonlySet<string> = new Set(['failed', 'canceled']);
