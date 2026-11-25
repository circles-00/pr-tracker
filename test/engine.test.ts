import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GitLabMergeRequest } from '../src/shared/types';

const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const notifications: { title: string; message: string; requireInteraction?: boolean }[] = [];

const createStorageArea = (data: Record<string, unknown>) => ({
  get: async (keys: string | string[]) => {
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        if (k in data) out[k] = structuredClone(data[k]);
      }
      return out;
    }
    return keys in data ? { [keys]: structuredClone(data[keys]) } : {};
  },
  set: async (obj: Record<string, unknown>) => {
    Object.assign(data, structuredClone(obj));
  },
  remove: async (key: string) => {
    delete data[key];
  },
});

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: createStorageArea(local), session: createStorageArea(session) },
  runtime: { getURL: (p: string) => `chrome-extension://x/${p}` },
  identity: { getRedirectURL: () => 'https://x.chromiumapp.org/' },
  notifications: {
    create: (_id: string, opts: { title: string; message: string; requireInteraction?: boolean }) =>
      notifications.push(opts),
  },
};

const PID = 7;
const state = {
  feature: { iid: 1, state: 'opened' as const, target_branch: 'develop', merge_commit_sha: null as string | null },
  promo: null as null | {
    iid: number;
    state: 'opened' | 'merged';
    merge_when_pipeline_succeeds: boolean;
    merge_commit_sha: string | null;
    detailed_merge_status: string;
  },
  master: 'm0',
  develop: 'd0',
  ancestry: new Set<string>(),
  pipelines: [] as { id: number; status: string; ref: string; sha: string }[],
  calls: [] as string[],
};

const mrJson = (iid: number, extra: Partial<GitLabMergeRequest>): GitLabMergeRequest => ({
  id: iid,
  iid,
  project_id: PID,
  title: iid === 1 ? 'Feature' : 'Release',
  state: 'opened',
  source_branch: iid === 1 ? 'feat' : 'develop',
  target_branch: iid === 1 ? 'develop' : 'master',
  web_url: `https://gitlab.com/g/app/-/merge_requests/${iid}`,
  sha: iid === 1 ? 'f1' : state.develop,
  merge_commit_sha: null,
  squash_commit_sha: null,
  author: { username: 'nik' },
  references: { full: `g/app!${iid}` },
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '',
  head_pipeline: null,
  ...extra,
});

const baseFetch = async (url: string, init: { method?: string; body?: string } = {}): Promise<Response> => {
  const u = new URL(url);
  const path = u.pathname.replace('/api/v4', '');
  const method = init.method ?? 'GET';
  state.calls.push(`${method} ${path}`);
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  if (path === '/user') return ok({ id: 1, username: 'nik', name: 'Nik', avatar_url: '' });
  if (path === '/merge_requests') {
    const after = u.searchParams.get('created_after');
    return ok(after && after > '2025-01-01T00:00:00Z' ? [] : [mrJson(1, state.feature)]);
  }
  const single = path.match(new RegExp(`^/projects/${PID}/pipelines/(\\d+)(/jobs)?$`));
  if (single) {
    const p = state.pipelines.find((x) => x.id === Number(single[1]))!;
    if (single[2]) return ok(p.status === 'failed' ? [{ name: 'Lint', stage: 'test' }] : []);
    return ok({ ...p, web_url: `https://gitlab.com/g/app/-/pipelines/${p.id}` });
  }
  if (path.includes('/repository/commits/')) return ok({ title: 'Fix the thing' });
  if (path === `/projects/${PID}` || path === '/projects/g%2Fapp') {
    return ok({ id: PID, path_with_namespace: 'g/app', default_branch: 'develop' });
  }
  const br = path.match(/\/repository\/branches\/(.+)$/);
  if (br) {
    const name = decodeURIComponent(br[1]);
    if (name === 'main') return ok({ message: '404' }, 404);
    return ok({ name, commit: { id: name === 'master' ? state.master : state.develop } });
  }
  if (path.endsWith('/repository/merge_base')) {
    const [a, b] = u.searchParams.getAll('refs[]');
    return ok({ id: state.ancestry.has(`${a}>${b}`) ? a : 'other' });
  }
  if (path === `/projects/${PID}/merge_requests/1`) return ok(mrJson(1, state.feature));
  if (path === `/projects/${PID}/merge_requests` && method === 'GET') {
    return ok(state.promo && state.promo.state === 'opened' ? [mrJson(state.promo.iid, state.promo)] : []);
  }
  if (path === `/projects/${PID}/merge_requests` && method === 'POST') {
    const body = JSON.parse(init.body!) as { remove_source_branch: boolean };
    assert.equal(body.remove_source_branch, false, 'must never delete develop');
    state.promo = {
      iid: 2,
      state: 'opened',
      merge_when_pipeline_succeeds: false,
      merge_commit_sha: null,
      detailed_merge_status: 'ci_must_pass',
    };
    return ok(mrJson(2, state.promo), 201);
  }
  if (path === `/projects/${PID}/merge_requests/2/merge` && method === 'PUT') {
    const body = JSON.parse(init.body!) as { should_remove_source_branch: boolean };
    assert.equal(body.should_remove_source_branch, false);
    state.promo!.merge_when_pipeline_succeeds = true;
    return ok(mrJson(2, state.promo!));
  }
  if (path === `/projects/${PID}/merge_requests/2`) return ok(mrJson(2, state.promo!));
  if (path === `/projects/${PID}/pipelines`) {
    let list = state.pipelines.filter((p) => p.ref === u.searchParams.get('ref'));
    if (u.searchParams.get('sha')) list = list.filter((p) => p.sha === u.searchParams.get('sha'));
    if (u.searchParams.get('status')) list = list.filter((p) => p.status === u.searchParams.get('status'));
    return ok(list.map((p) => ({ ...p, web_url: `https://gitlab.com/g/app/-/pipelines/${p.id}` })).reverse());
  }
  if (path === '/html-502') return new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 });
  return ok({ message: `unhandled ${method} ${path}` }, 500);
};

(globalThis as unknown as { fetch: typeof baseFetch }).fetch = baseFetch;

const { runPollTick } = await import('../src/domain/tick');
const { catchUpWatch } = await import('../src/domain/mr-machine');
const { createWatch } = await import('../src/domain/watch-factory');
const { watchPipeline } = await import('../src/domain/pipelines');
const { GitLabClient, GitLabError } = await import('../src/api/gitlab');
const { notifications: notificationService } = await import('../src/platform/notifications');
const { describeWatch, stageText } = await import('../src/shared/format');
const { DEFAULT_SETTINGS } = await import('../src/shared/constants');
const { coversPipeline } = await import('../src/shared/target');
const { historyDb } = await import('../src/platform/history-db');
const { storage: store } = await import('../src/platform/storage');

const firstWatch = async () => Object.values(await store.get('watches'))[0];
const titles = () => notifications.map((n) => n.title);

test('feature → develop → auto promotion → master pipeline → staging', async () => {
  await store.set('auth', { kind: 'pat', token: 't' });
  await runPollTick();
  await store.update('rules', (r) => r.map((x) => ({ ...x, autoPromote: 'on', createdAt: '2020-01-01T00:00:00Z' })));
  await store.set('lastDiscovery', null);

  await runPollTick();
  assert.equal((await firstWatch()).stage, 'open');

  state.feature = { ...state.feature, state: 'merged' as unknown as 'opened', merge_commit_sha: 'f1m' };
  state.develop = 'f1m';
  state.ancestry.add('f1m>f1m');
  await runPollTick();
  let w = await firstWatch();
  assert.equal(w.stage, 'promotion_open', 'promotion MR created in the same tick');
  assert.equal(w.promotion?.iid, 2);
  assert.ok(w.mergedAt, 'mergedAt timestamp recorded');
  assert.ok(titles().includes('Merged into develop'));
  assert.ok(titles().includes('Opened develop → master'));

  await runPollTick();
  w = await firstWatch();
  assert.equal(w.promotion?.autoMergeSet, true);
  assert.ok(titles().includes('Auto-merge enabled'));

  state.promo = { ...state.promo!, state: 'merged', merge_commit_sha: 'm1' };
  state.master = 'm1';
  state.pipelines.push({ id: 100, status: 'running', ref: 'master', sha: 'm1' });
  await runPollTick();
  w = await firstWatch();
  assert.equal(w.stage, 'on_master');
  assert.equal(w.pipeline?.status, 'running');
  assert.ok(titles().includes('Merged into master'));
  assert.ok(!titles().includes('✅ On staging'), 'merged is not enough, pipeline must finish');

  state.pipelines[0].status = 'failed';
  await runPollTick();
  assert.ok(titles().includes('❌ master pipeline failed'));
  assert.equal((await firstWatch()).stage, 'on_master', 'keeps watching after failure');

  state.pipelines[0].status = 'success';
  await runPollTick();
  assert.equal(await firstWatch(), undefined, 'moved to history');
  const [done] = await historyDb.table('mrHistory').recent('by_finishedAt', 10);
  assert.equal(done.stage, 'done');
  assert.ok(coversPipeline(done, 'g/app', 100), 'master pipeline counts as part of the MR');
  assert.ok(!coversPipeline(done, 'g/app', 999));
  assert.ok(titles().includes('✅ On staging'));

  await runPollTick();
  assert.equal(Object.keys(await store.get('watches')).length, 0);
  assert.equal(titles().filter((t) => t === '✅ On staging').length, 1);
});

test('pipeline watch notifies when it finishes, with failed job names', async () => {
  state.pipelines.push({ id: 200, status: 'running', ref: 'feat', sha: 'f9' });
  const res = await watchPipeline(new GitLabClient('https://gitlab.com'), 'g/app', 200);
  assert.equal(res.finished, false);
  assert.equal((await store.get('pipelineWatches'))[res.key].title, 'Fix the thing');

  await runPollTick();
  assert.equal(Object.keys(await store.get('pipelineWatches')).length, 1);

  state.pipelines.find((p) => p.id === 200)!.status = 'failed';
  await runPollTick();
  assert.equal(Object.keys(await store.get('pipelineWatches')).length, 0);
  const last = notifications.at(-1)!;
  assert.equal(last.title, '❌ Pipeline failed');
  assert.match(last.message, /Failed: Lint/);
  const [pipeHist] = await historyDb.table('pipelineHistory').recent('by_finishedAt', 10);
  assert.equal(pipeHist.status, 'failed');
});

test('a develop → master MR is tracked to staging but never promoted', async () => {
  const callsBefore = state.calls.length;
  const promoMr = mrJson(3, {
    state: 'merged',
    source_branch: 'develop',
    target_branch: 'master',
    merge_commit_sha: 'm3',
  });
  const w = createWatch(promoMr, 'g/app', {
    ruleId: null,
    notify: { merged: true, promotion: true, masterMerged: true, staging: true, failures: true },
    autoPromote: 'on',
  });
  await store.update('watches', (all) => {
    all[w.key] = w;
  });

  (globalThis as unknown as { fetch: typeof baseFetch }).fetch = (url, init) =>
    new URL(url).pathname.endsWith(`/projects/${PID}/merge_requests/3`)
      ? Promise.resolve(new Response(JSON.stringify(promoMr)))
      : baseFetch(url, init);
  state.pipelines.push({ id: 300, status: 'running', ref: 'master', sha: 'm3' });

  await runPollTick();
  const watched = (await store.get('watches'))[w.key];
  assert.equal(watched.stage, 'on_master');
  assert.equal(watched.promotion, undefined);
  assert.ok(!state.calls.slice(callsBefore).some((c) => c.startsWith('POST') || c.startsWith('PUT')));
  assert.ok(!notifications.some((n) => n.message.includes('!3') && /Promote|Opening/.test(n.message)));

  state.pipelines.find((p) => p.id === 300)!.status = 'success';
  await runPollTick();
  const [latest] = await historyDb.table('mrHistory').recent('by_finishedAt', 1);
  assert.equal(latest.key, w.key);
  assert.equal(notifications.at(-1)!.title, '✅ On staging');
  (globalThis as unknown as { fetch: typeof baseFetch }).fetch = baseFetch;
});

test('manually adding an already-finished MR catches up silently and reports it', async () => {
  state.ancestry.add('f1m>m1');
  state.master = 'm1';
  const before = notifications.length;

  const mr = mrJson(1, state.feature);
  const w = createWatch(mr, 'g/app', {
    ruleId: null,
    notify: { merged: true, promotion: true, masterMerged: true, staging: true, failures: true },
    autoPromote: 'on',
  });
  const { finished, repo } = await catchUpWatch(new GitLabClient('https://gitlab.com'), w);

  assert.equal(finished, true);
  assert.equal(w.stage, 'done');
  assert.equal(notifications.length, before, 'no notifications for stages that already happened');
  assert.match(describeWatch(w, repo), /Already on staging/);
  assert.ok(w.log.some((l) => l.text === '✅ On staging'), 'stages still recorded in the log');
  assert.equal(w.catchingUp, undefined);
});

test('manually adding a pipeline that already finished goes straight to history', async () => {
  const before = notifications.length;
  const res = await watchPipeline(new GitLabClient('https://gitlab.com'), 'g/app', 100);
  assert.equal(res.finished, true);
  assert.match(res.message, /already passed/);
  assert.equal(Object.keys(await store.get('pipelineWatches')).length, 0);
  await runPollTick();
  assert.equal(notifications.length, before);
});

test('notifications record explicit severity in the feed even with system notifications off', async () => {
  const before = notifications.length;
  await store.update('settings', (s) => ({ ...s, desktopNotifications: false }));
  await notificationService.show({
    title: 'On staging',
    message: 'x',
    url: 'https://gitlab.com/a',
    severity: 'success',
    promoteKey: 'k',
  });
  assert.equal(notifications.length, before, 'no OS notification');
  const [item] = await store.get('feed');
  assert.equal(item.title, 'On staging');
  assert.equal(item.severity, 'success');
  assert.equal(item.read, false);
  assert.equal(item.promoteKey, 'k');
  await store.update('settings', (s) => ({ ...s, desktopNotifications: true }));
});

test('non-JSON HTTP error pages throw GitLabError instead of SyntaxError', async () => {
  const gl = new GitLabClient('https://gitlab.com');
  await assert.rejects(
    () => gl.get('/html-502'),
    (err: unknown) => err instanceof GitLabError && err.status === 502,
  );
});

test('on_master status is green while pipeline runs and red if it fails, and toast defaults to bottom-right', () => {
  assert.equal(DEFAULT_SETTINGS.toastPosition, 'bottom-right');
  const base = createWatch(mrJson(9, { state: 'merged' }), 'g/app', {
    ruleId: null,
    notify: { merged: true, promotion: true, masterMerged: true, staging: true, failures: true },
    autoPromote: 'off',
  });
  base.stage = 'on_master';
  base.pipeline = { id: 1, webUrl: 'https://gitlab.com/g/app/-/pipelines/1', status: 'running' };
  const running = stageText(base);
  assert.equal(running.tone, 'ok');
  assert.match(running.text, /On master/);

  base.pipeline.status = 'failed';
  const failed = stageText(base);
  assert.equal(failed.tone, 'bad');
});
