import { FEED_LIMIT } from '../shared/constants';
import type { FeedItem, NotifyPrefs, NotifySeverity, PipelineWatch, Watch } from '../shared/types';
import { session, type PendingNotification } from './session';
import { storage } from './storage';

export type NotifyKind = keyof NotifyPrefs | 'threads';

export interface NotificationPayload {
  title: string;
  message: string;
  url: string;
  severity: NotifySeverity;
  promoteKey?: string;
}

export interface WatchNotifyOptions {
  severity?: NotifySeverity;
  promoteButton?: boolean;
  action?: boolean;
}

export class NotificationService {
  async notifyWatch(
    watch: Watch,
    kind: NotifyKind,
    dedupeKey: string,
    title: string,
    message: string,
    url: string,
    opts: WatchNotifyOptions = {},
  ): Promise<void> {
    if (watch.sent.includes(dedupeKey)) return;

    watch.sent.push(dedupeKey);
    watch.log.push({ at: new Date().toISOString(), text: title });

    if (watch.catchingUp && !opts.action) return;
    if (watch.muted) return;
    if (kind !== 'threads' && !watch.notify[kind]) return;

    await this.show({
      title,
      message: `${watch.projectPath}!${watch.iid} · ${watch.title}\n${message}`,
      url,
      severity: opts.severity ?? (kind === 'failures' ? 'error' : kind === 'staging' ? 'success' : 'info'),
      promoteKey: opts.promoteButton ? watch.key : undefined,
    });
  }

  async notifyPipeline(
    watch: PipelineWatch,
    dedupeKey: string,
    title: string,
    message: string,
    severity: NotifySeverity,
  ): Promise<void> {
    if (watch.sent.includes(dedupeKey)) return;

    watch.sent.push(dedupeKey);
    if (watch.muted) return;

    await this.show({
      title,
      message: `${watch.projectPath} · ${watch.ref} #${watch.pipelineId}\n${message}`,
      url: watch.webUrl,
      severity,
    });
  }

  async show(payload: NotificationPayload): Promise<void> {
    const id = `gr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: FeedItem = {
      id,
      title: payload.title,
      message: payload.message,
      url: payload.url,
      severity: payload.severity,
      promoteKey: payload.promoteKey,
      at: new Date().toISOString(),
      read: false,
    };

    await storage.update('feed', (feed) => [item, ...feed].slice(0, FEED_LIMIT));

    const settings = await storage.get('settings');
    if (!settings.desktopNotifications) return;

    await session.setPendingNotification(id, { url: payload.url, promoteKey: payload.promoteKey });
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: payload.title,
      message: payload.message,
      priority: 2,
      requireInteraction: payload.severity === 'success' || payload.severity === 'error',
      buttons: payload.promoteKey ? [{ title: 'Promote now' }, { title: 'Open MR' }] : undefined,
    });
  }

  clear(id: string): void {
    chrome.notifications.clear(id);
  }

  onClicked(listener: (id: string, pending: PendingNotification | undefined) => Promise<void> | void): void {
    chrome.notifications.onClicked.addListener(async (id) => {
      const pending = await session.getPendingNotification(id);
      this.clear(id);
      await session.clearPendingNotification(id);
      await listener(id, pending);
    });
  }

  onButtonClicked(
    listener: (id: string, buttonIndex: number, pending: PendingNotification) => Promise<void> | void,
  ): void {
    chrome.notifications.onButtonClicked.addListener(async (id, buttonIndex) => {
      const pending = await session.getPendingNotification(id);
      if (!pending) return;

      this.clear(id);
      await session.clearPendingNotification(id);
      await listener(id, buttonIndex, pending);
    });
  }

  onClosed(listener: (id: string) => void): void {
    chrome.notifications.onClosed.addListener((id) => {
      void session.clearPendingNotification(id);
      listener(id);
    });
  }
}

export const notifications = new NotificationService();
