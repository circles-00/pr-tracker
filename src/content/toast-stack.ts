import { bus } from '../platform/messaging';
import { storage, type LocalStorageChanges } from '../platform/storage';
import { TOAST_DURATION_MS } from '../shared/constants';
import { severityToTone } from '../shared/format';
import type { FeedItem, ToastPosition } from '../shared/types';
import type { SidebarLayoutTracker } from './sidebar-layout';
import {
  COLOR_ACCENT,
  COLOR_BAD,
  COLOR_MUTED,
  COLOR_OK,
  COLOR_SURFACE,
  COLOR_TEXT,
  COLOR_WARN,
  FONT_STACK,
  Z_INDEX_TOAST,
} from './styles';

const TOAST_TEMPLATE = `
  <style>
    .stack {
      display: flex; flex-direction: column-reverse; gap: 8px;
      width: 340px; max-width: calc(100vw - 40px);
      font: 13px/1.4 ${FONT_STACK};
    }
    .stack.top { flex-direction: column; }
    .t {
      background: ${COLOR_SURFACE}; color: ${COLOR_TEXT};
      border-radius: 10px; padding: 10px 12px; position: relative;
      box-shadow: 0 6px 20px rgba(0, 0, 0, .35);
      border-left: 3px solid ${COLOR_ACCENT};
      animation: in .18s ease-out;
    }
    .t.ok { border-left-color: ${COLOR_OK}; }
    .t.warn { border-left-color: ${COLOR_WARN}; }
    .t.bad { border-left-color: ${COLOR_BAD}; }
    @keyframes in { from { opacity: 0; transform: translateY(6px); } }
    .title { font-weight: 600; padding-right: 18px; }
    .msg { color: ${COLOR_MUTED}; white-space: pre-line; margin-top: 2px; font-size: 12px; }
    .actions { display: flex; gap: 6px; margin-top: 8px; }
    button {
      border: 0; border-radius: 6px; padding: 5px 10px;
      font: inherit; font-size: 12px; cursor: pointer;
      background: #34333c; color: ${COLOR_TEXT};
    }
    button.primary { background: ${COLOR_ACCENT}; color: #fff; }
    .close { position: absolute; top: 6px; right: 6px; background: transparent; color: #9d9ca8; padding: 2px 6px; }
  </style>
  <div class="stack"></div>
`;

export class ToastStackController {
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly stack: HTMLDivElement;
  private position: ToastPosition = 'bottom-right';

  constructor(private readonly layout: SidebarLayoutTracker) {
    this.host = document.createElement('div');
    this.host.id = 'gitlab-reminders-toasts';
    this.host.style.position = 'fixed';
    this.host.style.zIndex = String(Z_INDEX_TOAST);

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = TOAST_TEMPLATE;
    this.stack = this.shadow.querySelector<HTMLDivElement>('.stack')!;
    this.applyPosition(this.position);
  }

  async onStorageChanged(changes: LocalStorageChanges): Promise<void> {
    if (changes.settings?.newValue?.toastPosition) {
      this.applyPosition(changes.settings.newValue.toastPosition);
    }

    if (!changes.feed || document.visibilityState !== 'visible') return;

    const settings = await storage.get('settings');
    if (!settings.pageToasts) return;

    const beforeIds = new Set((changes.feed.oldValue ?? []).map((item) => item.id));
    const currentFeed = changes.feed.newValue ?? [];
    const fresh = currentFeed.filter((item) => !beforeIds.has(item.id) && !item.read);

    if (fresh.length > 0 && !this.host.isConnected) {
      document.documentElement.appendChild(this.host);
    }

    this.applyPosition(settings.toastPosition);
    fresh.reverse().forEach((item) => this.appendToast(item));

    for (const item of currentFeed) {
      if (item.read) this.shadow.getElementById(item.id)?.remove();
    }

    this.pruneHostIfEmpty();
  }

  destroy(): void {
    this.layout.removeFollower(this.host);
    this.host.remove();
  }

  private applyPosition(position: ToastPosition): void {
    this.position = position;

    const isTop = position.startsWith('top-');
    const isLeft = position.endsWith('-left');

    this.stack.classList.toggle('top', isTop);
    this.host.style.top = isTop ? '20px' : 'auto';
    this.host.style.bottom = isTop ? 'auto' : isLeft ? '70px' : '20px';
    this.host.style.right = isLeft ? 'auto' : '20px';
    this.host.style.left = isLeft ? '20px' : 'auto';

    if (this.host.isConnected) {
      if (isLeft) this.layout.addFollower(this.host);
      else this.layout.removeFollower(this.host);
    }
  }

  private pruneHostIfEmpty(): void {
    if (this.stack.children.length === 0 && this.host.isConnected) {
      this.layout.removeFollower(this.host);
      this.host.remove();
    }
  }

  private appendToast(item: FeedItem): void {
    if (this.shadow.getElementById(item.id)) return;

    const tone = severityToTone(item.severity);
    const el = document.createElement('div');
    el.id = item.id;
    el.className = tone ? `t ${tone}` : 't';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title;

    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.textContent = item.message;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const close = (markRead: boolean) => {
      el.remove();
      this.pruneHostIfEmpty();
      if (markRead) void bus.send('readFeed', { ids: [item.id] }).catch(() => undefined);
    };

    const makeBtn = (label: string, cls: string, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.className = cls;
      btn.addEventListener('click', onClick);
      return btn;
    };

    if (item.promoteKey) {
      const promoteKey = item.promoteKey;
      actions.append(
        makeBtn('Promote now', 'primary', () => {
          void bus.send('promote', { key: promoteKey }).catch(() => undefined);
          close(true);
        }),
      );
    }

    actions.append(
      makeBtn('Open', item.promoteKey ? '' : 'primary', () => {
        window.open(item.url, '_blank');
        close(true);
      }),
    );

    el.append(makeBtn('✕', 'close', () => close(true)), title, msg, actions);
    this.stack.prepend(el);

    if (!item.promoteKey) {
      let timer = setTimeout(() => close(false), TOAST_DURATION_MS);
      el.addEventListener('mouseenter', () => clearTimeout(timer));
      el.addEventListener('mouseleave', () => {
        timer = setTimeout(() => close(false), TOAST_DURATION_MS / 2);
      });
    }

    while (this.stack.children.length > 4) {
      this.stack.lastElementChild?.remove();
    }
  }
}
