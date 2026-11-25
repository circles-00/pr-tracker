import { bus } from '../platform/messaging';
import { storage, type LocalStorageChanges } from '../platform/storage';
import { stageLabel } from '../shared/format';
import { parseTarget, type Target } from '../shared/target';
import type { PipelineWatch, RepoConfig, Watch } from '../shared/types';
import type { SidebarLayoutTracker } from './sidebar-layout';
import { COLOR_ACCENT, COLOR_SURFACE, FONT_STACK, Z_INDEX_BASE } from './styles';

const WATCH_BUTTON_TEMPLATE = `
  <style>
    .wrap {
      position: fixed; left: 20px; bottom: 20px; z-index: ${Z_INDEX_BASE};
      display: flex; gap: 4px;
      font: 500 13px/1 ${FONT_STACK};
    }
    .toast {
      position: absolute; left: 0; bottom: calc(100% + 8px);
      width: max-content; max-width: 340px;
      padding: 9px 12px; border-radius: 9px;
      background: ${COLOR_SURFACE}; color: #fff; line-height: 1.35;
      box-shadow: 0 4px 14px rgba(0, 0, 0, .35);
      opacity: 0; transform: translateY(4px);
      transition: opacity .15s, transform .15s; pointer-events: none;
    }
    .toast.show { opacity: 1; transform: none; }
    button {
      border: 0; cursor: pointer; border-radius: 999px; padding: 10px 14px;
      font: inherit; box-shadow: 0 2px 8px rgba(0, 0, 0, .25);
    }
    .main { background: ${COLOR_ACCENT}; color: #fff; }
    .main.on { background: ${COLOR_SURFACE}; color: #fff; }
    .x { background: ${COLOR_SURFACE}; color: #bbb; padding: 10px 12px; }
    .min { background: ${COLOR_SURFACE}; color: #bbb; padding: 10px 11px; }
    .x[hidden], .min[hidden], .icon[hidden], .main[hidden] { display: none; }
    .icon {
      width: 38px; height: 38px; padding: 0;
      display: grid; place-items: center; font-size: 16px;
      background: ${COLOR_ACCENT}; color: #fff; position: relative;
    }
    .icon.on { background: ${COLOR_SURFACE}; }
    .icon.on::after {
      content: ''; position: absolute; top: 3px; right: 3px;
      width: 8px; height: 8px; border-radius: 50%; background: ${COLOR_ACCENT};
    }
    button:disabled { opacity: .7; cursor: default; }
  </style>
  <div class="wrap">
    <div class="toast" role="status"></div>
    <button class="icon" type="button" hidden>🔔</button>
    <button class="main" type="button"></button>
    <button class="x" type="button" title="Stop watching" hidden>✕</button>
    <button class="min" type="button" title="Collapse to an icon">‹</button>
  </div>
`;

export class WatchButtonController {
  private readonly host: HTMLDivElement;
  private readonly wrap: HTMLDivElement;
  private readonly mainBtn: HTMLButtonElement;
  private readonly unwatchBtn: HTMLButtonElement;
  private readonly toastEl: HTMLDivElement;
  private readonly iconBtn: HTMLButtonElement;
  private readonly minBtn: HTMLButtonElement;

  private collapsed = false;
  private current: Watch | PipelineWatch | null = null;
  private repoConfig: RepoConfig | undefined;
  private target: Target | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly layout: SidebarLayoutTracker) {
    this.host = document.createElement('div');
    this.host.id = 'gitlab-reminders-root';

    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = WATCH_BUTTON_TEMPLATE;

    this.wrap = shadow.querySelector<HTMLDivElement>('.wrap')!;
    this.mainBtn = shadow.querySelector<HTMLButtonElement>('.main')!;
    this.unwatchBtn = shadow.querySelector<HTMLButtonElement>('.x')!;
    this.toastEl = shadow.querySelector<HTMLDivElement>('.toast')!;
    this.iconBtn = shadow.querySelector<HTMLButtonElement>('.icon')!;
    this.minBtn = shadow.querySelector<HTMLButtonElement>('.min')!;

    this.minBtn.addEventListener('click', () => void bus.send('setUiCollapsed', { collapsed: true }).catch(() => undefined));
    this.iconBtn.addEventListener('click', () => void bus.send('setUiCollapsed', { collapsed: false }).catch(() => undefined));
    this.mainBtn.addEventListener('click', () => void this.handleMainClick());
    this.unwatchBtn.addEventListener('click', () => void this.handleUnwatchClick());

    void storage.get('uiCollapsed').then((collapsed) => {
      this.collapsed = collapsed;
      this.render();
    });
  }

  onRouteChange(): void {
    this.target = parseTarget(location.href);

    if (this.target && !this.host.isConnected) {
      document.body.appendChild(this.host);
      this.layout.addFollower(this.wrap);
    } else if (!this.target && this.host.isConnected) {
      this.layout.removeFollower(this.wrap);
      this.host.remove();
    }

    void this.refresh();
  }

  onStorageChanged(changes: LocalStorageChanges): void {
    if (changes.uiCollapsed) {
      this.collapsed = changes.uiCollapsed.newValue === true;
      this.render();
    }

    if (changes.watches || changes.pipelineWatches || changes.historyRevision || changes.repos) {
      void this.refresh();
    }
  }

  destroy(): void {
    clearTimeout(this.toastTimer);
    this.layout.removeFollower(this.wrap);
    this.host.remove();
  }

  private showToast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 6000);
  }

  private async refresh(): Promise<void> {
    if (!this.target) return;

    try {
      const [watch, repos] = await Promise.all([
        bus.send('status', { target: this.target }),
        storage.get('repos'),
      ]);
      this.current = watch;
      this.repoConfig = watch ? repos[watch.projectId] : undefined;
    } catch {
      this.current = null;
      this.repoConfig = undefined;
    }

    this.render();
  }

  private async handleMainClick(): Promise<void> {
    if (this.current?.finishedAt) {
      const label = 'stage' in this.current ? stageLabel(this.current.stage, this.repoConfig) : this.current.status;
      this.showToast(`Already watched (${label}).`);
      return;
    }

    if (this.current && 'stage' in this.current && this.target?.kind === 'pipeline') {
      this.showToast(
        `Already watched as part of ${this.current.projectPath.split('/').pop()}!${this.current.iid} “${this.current.title}”.`,
      );
      return;
    }

    if (!this.target || this.current) return;

    this.mainBtn.disabled = true;
    this.mainBtn.textContent = '🔔 Adding…';

    try {
      const result = await bus.send('watch', { target: this.target });
      this.showToast(result.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.showToast(`⚠️ ${message}`);
    } finally {
      this.mainBtn.disabled = false;
    }

    await this.refresh();
  }

  private async handleUnwatchClick(): Promise<void> {
    if (!this.current) return;

    await bus.send('unwatch', { key: this.current.key });
    this.current = null;
    this.render();
  }

  private render(): void {
    const viaMr = Boolean(this.current && 'stage' in this.current && this.target?.kind === 'pipeline');
    const historical = Boolean(this.current?.finishedAt);

    if (this.current && viaMr) {
      const watch = this.current as Watch;
      const prefix = historical ? '✓ Already watched' : '🔔 Watching';
      this.mainBtn.textContent = `${prefix} · part of !${watch.iid}`;
      this.mainBtn.title = `Tracked as part of ${watch.projectPath}!${watch.iid} “${watch.title}” (${stageLabel(watch.stage, this.repoConfig)})`;
      this.mainBtn.classList.add('on');
    } else if (this.current) {
      const label = 'stage' in this.current ? stageLabel(this.current.stage, this.repoConfig) : this.current.status;
      const prefix = historical ? '✓ Already watched' : '🔔 Watching';
      this.mainBtn.textContent = `${prefix} · ${label}`;
      this.mainBtn.title = '';
      this.mainBtn.classList.add('on');
    } else {
      this.mainBtn.title = '';
      this.mainBtn.textContent = this.target?.kind === 'pipeline' ? '🔔 Watch pipeline' : '🔔 Watch until staging';
      this.mainBtn.classList.remove('on');
    }

    this.iconBtn.classList.toggle('on', Boolean(this.current));
    this.iconBtn.title = `${(this.mainBtn.textContent ?? '').replace(/^(🔔|✓) /, '')} (click to expand)`;
    this.iconBtn.hidden = !this.collapsed;
    this.mainBtn.hidden = this.collapsed;
    this.minBtn.hidden = this.collapsed;
    this.unwatchBtn.hidden = this.collapsed || !this.current || viaMr || historical;
  }
}
