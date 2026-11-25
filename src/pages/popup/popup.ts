import { extension } from '../../platform/extension';
import { bus } from '../../platform/messaging';
import { storage } from '../../platform/storage';
import { stageText, timeAgo, type Tone } from '../../shared/format';
import { coversPipeline, parseTarget, type Target } from '../../shared/target';
import { byId, h } from '../shared/dom';
import { createDeferredRenderer } from '../shared/storage-sync';
import { addWatchForm } from './add-form';
import { PIPELINE_TONES, pipelineCard, watchCard } from './cards';
import { feedSection } from './feed';

const main = byId('main');
const who = byId('who');
const pauseBtn = byId<HTMLButtonElement>('pause');
const refreshBtn = byId<HTMLButtonElement>('refresh');
const settingsBtn = byId<HTMLButtonElement>('settings');

settingsBtn.addEventListener('click', () => extension.openOptions());

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  await bus.send('tick').catch(() => undefined);
  refreshBtn.disabled = false;
});

pauseBtn.addEventListener('click', async () => {
  const settings = await storage.get('settings');
  await bus.send('updateSettings', { patch: { paused: !settings.paused } });
});

let flashMessage: { text: string; until: number } | null = null;

async function currentTabTarget(): Promise<Target | null> {
  const url = await extension.activeTabUrl();
  return url ? parseTarget(url) : null;
}

async function render(): Promise<void> {
  const [data, tabTarget, historyData] = await Promise.all([
    storage.getMany([
      'auth',
      'me',
      'authError',
      'watches',
      'pipelineWatches',
      'repos',
      'settings',
      'feed',
    ]),
    currentTabTarget(),
    bus.send('getHistory', { limit: 40 }).catch(() => ({ mrs: [], pipelines: [] })),
  ]);

  const { auth, me, authError, watches, pipelineWatches, repos, settings, feed } = data;
  const { mrs: history, pipelines: pipelineHistory } = historyData;
  const tabMatch = tabTarget ? await bus.send('status', { target: tabTarget }).catch(() => null) : null;

  pauseBtn.textContent = settings.paused ? '▶' : '⏸';
  pauseBtn.title = settings.paused ? 'Resume checking' : 'Pause checking';

  who.replaceChildren(
    ...(me
      ? [h('img', { class: 'avatar', src: me.avatarUrl, alt: '' }), h('span', { title: `@${me.username}` }, `@${me.username}`)]
      : []),
  );

  if (!auth) {
    main.replaceChildren(
      h(
        'div',
        { class: 'card stack' },
        h('div', {}, 'Connect your GitLab account to start tracking MRs.'),
        h('button', { type: 'button', class: 'primary', onclick: () => extension.openOptions() }, 'Sign in'),
      ),
    );
    return;
  }

  const watchList = Object.values(watches).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pipeList = Object.values(pipelineWatches).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const tabState = !tabMatch ? 'unwatched' : tabMatch.finishedAt ? 'history' : 'active';

  const coveringMr =
    tabTarget?.kind === 'pipeline'
      ? watchList.find((w) => coversPipeline(w, tabTarget.projectPath, tabTarget.id))
      : undefined;

  type HistoryRow = { title: string; url: string; text: string; tone: Tone; at?: string };
  const rows: HistoryRow[] = [
    ...history.map((w) => ({ title: w.title, url: w.webUrl, ...stageText(w, repos[w.projectId]), at: w.finishedAt })),
    ...pipelineHistory.map((w) => ({
      title: `#${w.pipelineId} · ${w.title}`,
      url: w.webUrl,
      text: w.status,
      tone: PIPELINE_TONES[w.status] ?? '',
      at: w.finishedAt,
    })),
  ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));

  const onAdded = (message: string) => {
    flashMessage = { text: message, until: Date.now() + 8000 };
    void render();
  };

  const children = [
    authError &&
      h(
        'div',
        { class: 'banner' },
        authError,
        ' ',
        h('a', { href: '#', onclick: () => extension.openOptions() }, 'Fix'),
      ),
    settings.paused && h('div', { class: 'pill warn' }, 'Paused, not checking GitLab'),
    feedSection(feed),
    addWatchForm(tabTarget, tabState, onAdded),
    coveringMr &&
      h(
        'div',
        { class: 'card small' },
        '🔔 This pipeline is watched as part of ',
        h('a', { href: coveringMr.webUrl, target: '_blank' }, `!${coveringMr.iid} ${coveringMr.title}`),
        '.',
      ),
    flashMessage && flashMessage.until > Date.now() && h('div', { class: 'card small' }, flashMessage.text),
    pipeList.length > 0 && h('div', { class: 'stack' }, pipeList.map(pipelineCard)),
    watchList.length > 0
      ? h('div', { class: 'stack' }, watchList.map((w) => watchCard(w, repos[w.projectId])))
      : !pipeList.length &&
        h('div', { class: 'muted small' }, 'Nothing being watched. Rules pick up your new MRs automatically.'),
    rows.length > 0 &&
      h(
        'details',
        {},
        h('summary', {}, `History (${rows.length})`),
        rows.slice(0, 40).map((r) =>
          h(
            'div',
            { class: 'hist row small' },
            h('a', { class: 'grow truncate', href: r.url, target: '_blank', title: r.title }, r.title),
            h('span', { class: `pill ${r.tone}` }, r.text),
            h('span', { class: 'muted' }, timeAgo(r.at)),
          ),
        ),
      ),
  ].filter((node): node is HTMLElement => Boolean(node));

  main.replaceChildren(...children);
}

const scheduleRender = createDeferredRenderer(document, render);
storage.onChanged(() => scheduleRender());
void render();
