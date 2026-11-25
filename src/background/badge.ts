import { extension } from '../platform/extension';
import { storage } from '../platform/storage';

export async function refreshBadge(): Promise<void> {
  const { watches, pipelineWatches, feed, authError, auth, settings } = await storage.getMany([
    'watches',
    'pipelineWatches',
    'feed',
    'authError',
    'auth',
    'settings',
  ]);

  const activeCount = Object.keys(watches).length + Object.keys(pipelineWatches).length;
  const unreadCount = feed.filter((item) => !item.read).length;

  if (!auth || authError) {
    await extension.setBadge('!', '#d93025');
    return;
  }

  if (unreadCount > 0 && !settings.paused) {
    await extension.setBadge(String(unreadCount), '#d93025');
    return;
  }

  const text = settings.paused ? '‖' : activeCount ? String(activeCount) : '';
  const color = settings.paused ? '#80868b' : '#fc6d26';
  await extension.setBadge(text, color);
}
