export class ExtensionApi {
  isContextValid(): boolean {
    return Boolean(chrome.runtime?.id);
  }

  getVersion(): string {
    return chrome.runtime.getManifest().version;
  }

  reload(): void {
    chrome.runtime.reload();
  }

  requestUpdateCheck(timeoutMs = 3000): Promise<{ status: string; version?: string }> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (result: { status: string; version?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => done({ status: 'timeout' }), timeoutMs);

      try {
        chrome.runtime.requestUpdateCheck((status, details) => {
          if (chrome.runtime.lastError) {
            done({ status: 'error' });
            return;
          }
          done({ status, version: details?.version });
        });
      } catch {
        done({ status: 'error' });
      }
    });
  }

  openOptions(): void {
    chrome.runtime.openOptionsPage();
  }

  async openTab(url: string): Promise<void> {
    await chrome.tabs.create({ url });
  }

  async activeTabUrl(): Promise<string | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url ?? null;
  }

  async setBadge(text: string, color: string): Promise<void> {
    await Promise.all([
      chrome.action.setBadgeText({ text }),
      chrome.action.setBadgeBackgroundColor({ color }),
    ]);
  }

  async scheduleAlarm(name: string, periodInMinutes: number, delayInMinutes = 0.5): Promise<void> {
    await chrome.alarms.clear(name);
    chrome.alarms.create(name, {
      periodInMinutes: Math.max(0.5, periodInMinutes),
      delayInMinutes,
    });
  }

  onAlarm(name: string, listener: () => void): void {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === name) listener();
    });
  }

  onInstalled(listener: (reason: chrome.runtime.InstalledDetails['reason']) => void): void {
    chrome.runtime.onInstalled.addListener((details) => listener(details.reason));
  }

  onStartup(listener: () => void): void {
    chrome.runtime.onStartup.addListener(listener);
  }

  onUpdateAvailable(listener: (version: string) => void): void {
    chrome.runtime.onUpdateAvailable.addListener((details) => listener(details.version));
  }

  hasOriginPermission(origin: string): Promise<boolean> {
    return chrome.permissions.contains({ origins: [`${origin}/*`] });
  }

  requestOriginPermission(origin: string): Promise<boolean> {
    return chrome.permissions.request({ origins: [`${origin}/*`] });
  }

  async syncContentScript(id: string, origin: string | null, js: string[]): Promise<void> {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    }

    if (!origin || !(await this.hasOriginPermission(origin))) return;

    await chrome.scripting.registerContentScripts([
      {
        id,
        matches: [`${origin}/*`],
        js,
        runAt: 'document_idle',
      },
    ]);
  }

  getRedirectUrl(): string {
    return chrome.identity.getRedirectURL();
  }

  launchWebAuthFlow(url: string): Promise<string | undefined> {
    return chrome.identity.launchWebAuthFlow({ url, interactive: true });
  }
}

export const extension = new ExtensionApi();
