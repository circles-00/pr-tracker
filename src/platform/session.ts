export interface PendingNotification {
  url: string;
  promoteKey?: string;
}

const EXPECT_TOKEN_KEY = 'expectTokenUntil';
const PENDING_PREFIX = 'notif:';

export class SessionStore {
  async setPendingNotification(id: string, pending: PendingNotification): Promise<void> {
    await chrome.storage.session.set({ [`${PENDING_PREFIX}${id}`]: pending });
  }

  async getPendingNotification(id: string): Promise<PendingNotification | undefined> {
    const key = `${PENDING_PREFIX}${id}`;
    const res = await chrome.storage.session.get(key);
    return res[key] as PendingNotification | undefined;
  }

  async clearPendingNotification(id: string): Promise<void> {
    await chrome.storage.session.remove(`${PENDING_PREFIX}${id}`);
  }

  async setExpectTokenUntil(timestampMs: number): Promise<void> {
    await chrome.storage.session.set({ [EXPECT_TOKEN_KEY]: timestampMs });
  }

  async getExpectTokenUntil(): Promise<number | null> {
    const res = await chrome.storage.session.get(EXPECT_TOKEN_KEY);
    return typeof res[EXPECT_TOKEN_KEY] === 'number' ? res[EXPECT_TOKEN_KEY] : null;
  }

  async clearExpectToken(): Promise<void> {
    await chrome.storage.session.remove(EXPECT_TOKEN_KEY);
  }
}

export const session = new SessionStore();
