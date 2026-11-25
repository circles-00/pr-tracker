import { bus } from '../platform/messaging';
import { COLOR_ACCENT, COLOR_SURFACE, FONT_STACK, Z_INDEX_BASE } from './styles';

const TOKEN_PAGE_RE = /\/-\/(user_settings|profile)\/personal_access_tokens/;
const TOKEN_VALUE_RE = /^glpat-[\w.-]{20,}$/;
const BANNER_ID = 'gitlab-reminders-token';

const BANNER_TEMPLATE = `
  <style>
    .bar {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      z-index: ${Z_INDEX_BASE};
      display: flex; gap: 10px; align-items: center;
      padding: 10px 14px; border-radius: 10px;
      background: ${COLOR_SURFACE}; color: #fff;
      box-shadow: 0 4px 16px rgba(0, 0, 0, .35);
      font: 500 13px/1.3 ${FONT_STACK};
    }
    button { border: 0; border-radius: 7px; padding: 7px 12px; font: inherit; cursor: pointer; }
    .use { background: ${COLOR_ACCENT}; color: #fff; }
    .no { background: transparent; color: #bbb; }
  </style>
  <div class="bar">
    🔔 <span class="msg">Use this new token for PR Tracker?</span>
    <button class="use" type="button">Use token</button>
    <button class="no" type="button">Dismiss</button>
  </div>
`;

function findNewTokenInput(): string | null {
  for (const el of document.querySelectorAll<HTMLInputElement>('input')) {
    const value = el.value.trim();
    if (TOKEN_VALUE_RE.test(value)) return value;
  }

  return null;
}

export class TokenHandoffController {
  private observer: MutationObserver | null = null;
  private banner: HTMLDivElement | null = null;
  private dismissed = false;

  onRouteChange(): void {
    this.stopObserving();
    this.dismissed = false;

    if (!TOKEN_PAGE_RE.test(location.pathname)) return;
    void this.activateIfExpected();
  }

  destroy(): void {
    this.stopObserving();
    this.banner?.remove();
    this.banner = null;
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private async activateIfExpected(): Promise<void> {
    const expecting = await bus.send('isExpectingToken').catch(() => false);
    if (!expecting || this.dismissed) return;
    if (this.tryMountBanner()) return;

    this.observer = new MutationObserver(() => {
      if (this.tryMountBanner()) this.stopObserving();
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['value'],
    });
  }

  private tryMountBanner(): boolean {
    if (this.dismissed || document.getElementById(BANNER_ID)) return true;

    const token = findNewTokenInput();
    if (!token) return false;

    const bar = document.createElement('div');
    bar.id = BANNER_ID;

    const shadow = bar.attachShadow({ mode: 'open' });
    shadow.innerHTML = BANNER_TEMPLATE;

    const msgEl = shadow.querySelector<HTMLSpanElement>('.msg')!;

    shadow.querySelector<HTMLButtonElement>('.no')!.addEventListener('click', () => {
      this.dismissed = true;
      bar.remove();
      this.banner = null;
    });

    shadow.querySelector<HTMLButtonElement>('.use')!.addEventListener('click', async () => {
      try {
        const me = await bus.send('signInToken', { token });
        msgEl.textContent = `Signed in as @${me.username}. You can close this tab.`;
        shadow.querySelectorAll('button').forEach((b) => b.remove());
        setTimeout(() => {
          bar.remove();
          this.banner = null;
        }, 5000);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        msgEl.textContent = `Couldn't use the token: ${message}`;
      }
    });

    document.body.appendChild(bar);
    this.banner = bar;
    return true;
  }
}
