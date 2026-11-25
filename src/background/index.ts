import { extension } from '../platform/extension';
import { bus } from '../platform/messaging';
import { notifications } from '../platform/notifications';
import { storage } from '../platform/storage';
import { POLL_ALARM_NAME } from '../shared/constants';
import { refreshBadge } from './badge';
import { syncSelfHostedContentScript } from './content-scripts';
import { createMessageHandlers, runLockedTick } from './handlers';

async function schedulePollAlarm(): Promise<void> {
  const { pollMinutes } = await storage.get('settings');
  await extension.scheduleAlarm(POLL_ALARM_NAME, pollMinutes);
}

const handlers = createMessageHandlers();
bus.register(handlers);

extension.onAlarm(POLL_ALARM_NAME, () => {
  void runLockedTick();
});

notifications.onClicked(async (id, pending) => {
  if (pending) await extension.openTab(pending.url);
  await handlers.readFeed({ ids: [id] }, {});
});

notifications.onButtonClicked(async (id, buttonIndex, pending) => {
  if (buttonIndex === 0 && pending.promoteKey) {
    await handlers.promote({ key: pending.promoteKey }, {});
  } else {
    await extension.openTab(pending.url);
  }

  await handlers.readFeed({ ids: [id] }, {});
});

notifications.onClosed(() => undefined);

storage.onChanged((changes) => {
  if (changes.settings) {
    const before = changes.settings.oldValue;
    const after = changes.settings.newValue;

    if (before?.pollMinutes !== after?.pollMinutes) void schedulePollAlarm();
    if (before?.baseUrl !== after?.baseUrl) void syncSelfHostedContentScript();
  }

  if (
    changes.watches ||
    changes.pipelineWatches ||
    changes.feed ||
    changes.auth ||
    changes.authError ||
    changes.settings
  ) {
    void refreshBadge();
  }
});

extension.onInstalled((reason) => {
  void schedulePollAlarm();
  void refreshBadge();
  void syncSelfHostedContentScript();

  if (reason === 'install') extension.openOptions();
});

extension.onStartup(() => {
  void schedulePollAlarm();
  void runLockedTick();
});

extension.onUpdateAvailable(() => {
  extension.reload();
});
