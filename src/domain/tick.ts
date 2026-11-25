import { AuthMissingError, GitLabClient } from '../api/gitlab';
import { bumpHistoryRevision, historyDb } from '../platform/history-db';
import { storage } from '../platform/storage';
import { FINISHED_STAGES } from '../shared/constants';
import { createDefaultRule } from '../shared/rules';
import type { Me, Watch } from '../shared/types';
import { discoverMrs } from './discovery';
import { advanceWatch } from './mr-machine';
import { tickPipelines } from './pipelines';

export async function ensureMe(gl: GitLabClient): Promise<Me> {
  const { me: cached, rules } = await storage.getMany(['me', 'rules']);
  if (cached) return cached;

  const user = await gl.me();
  const me: Me = {
    id: user.id,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatar_url,
  };

  await storage.set('me', me);

  if (!rules.length) {
    await storage.set('rules', [createDefaultRule()]);
  }

  return me;
}

export async function runPollTick(): Promise<void> {
  const { settings, auth } = await storage.getMany(['settings', 'auth']);
  if (settings.paused || !auth) return;

  const gl = await GitLabClient.create();
  const me = await ensureMe(gl);
  const watches = await storage.get('watches');

  try {
    await discoverMrs(gl, me, watches);
  } catch (err) {
    console.warn('[pr-tracker] discovery failed', err);
  }

  try {
    await tickPipelines(gl);
  } catch (err) {
    console.warn('[pr-tracker] pipeline watches failed', err);
  }

  const finished: Watch[] = [];
  let authFailed = false;

  for (const watch of Object.values(watches)) {
    try {
      await advanceWatch(gl, watch);
      watch.updatedAt = new Date().toISOString();
    } catch (err) {
      console.warn(`[pr-tracker] ${watch.key} failed`, err);
      if (err instanceof AuthMissingError) {
        authFailed = true;
        break;
      }
    }

    if (FINISHED_STAGES.has(watch.stage)) {
      watch.finishedAt = new Date().toISOString();
      finished.push(watch);
      delete watches[watch.key];
    }
  }

  await storage.set('watches', watches);

  if (finished.length) {
    await historyDb.table('mrHistory').putMany(finished);
    await bumpHistoryRevision();
  }

  if (!authFailed) {
    await storage.set('authError', null);
  }
}
