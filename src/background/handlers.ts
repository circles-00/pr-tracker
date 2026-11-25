import { auth } from '../api/auth';
import { GitLabClient } from '../api/gitlab';
import { watchMr } from '../domain/mr-machine';
import { watchPipeline } from '../domain/pipelines';
import { ensureMe, runPollTick } from '../domain/tick';
import { historyDb } from '../platform/history-db';
import type { MessageHandlers } from '../platform/messaging';
import { notifications } from '../platform/notifications';
import { session } from '../platform/session';
import { storage } from '../platform/storage';
import { EXPECT_TOKEN_TTL_MS } from '../shared/constants';
import { coversPipeline, type Target } from '../shared/target';
import type { AddResult, PipelineWatch, Watch } from '../shared/types';
import { refreshBadge } from './badge';
import { stateLock } from './lock';

export async function runLockedTick(): Promise<void> {
  await stateLock.run(async () => {
    try {
      await runPollTick();
    } catch (err) {
      console.warn('[pr-tracker] tick failed', err);
    }

    await refreshBadge();
  });
}

async function findWatch(target: Target): Promise<Watch | PipelineWatch | null> {
  const db = historyDb;

  if (target.kind === 'pipeline') {
    const { pipelineWatches, watches } = await storage.getMany(['pipelineWatches', 'watches']);

    const own = Object.values(pipelineWatches).find(
      (w) => w.projectPath === target.projectPath && w.pipelineId === target.id,
    );
    if (own) return own;

    const covering = Object.values(watches).find((w) => coversPipeline(w, target.projectPath, target.id));
    if (covering) return covering;

    const pastPipe = await db.table('pipelineHistory').findByIndex('by_target', [target.projectPath, target.id]);
    if (pastPipe) return pastPipe;

    const candidates = await db.table('mrHistory').findAllByIndex('by_relatedPipelines', target.id);
    return candidates.find((w) => coversPipeline(w, target.projectPath, target.id)) ?? null;
  }

  const watches = await storage.get('watches');
  const active = Object.values(watches).find((w) => w.projectPath === target.projectPath && w.iid === target.id);
  if (active) return active;

  const pastMr = await db.table('mrHistory').findByIndex('by_target', [target.projectPath, target.id]);
  return pastMr ?? null;
}

async function patchWatch(key: string, fn: (watch: Watch) => void): Promise<void> {
  await storage.update('watches', (all) => {
    if (all[key]) fn(all[key]);
  });
}

export function createMessageHandlers(): MessageHandlers {
  return {
    status: ({ target }) => findWatch(target),

    watch: async ({ target }) => {
      if (target.kind === 'pipeline') {
        const owner = await findWatch(target);
        if (owner && !owner.finishedAt && 'stage' in owner) {
          return {
            key: owner.key,
            finished: false,
            message: `Already watched as part of ${owner.projectPath.split('/').pop()}!${owner.iid} “${owner.title}”.`,
          } satisfies AddResult;
        }
      }

      const result = await stateLock.run(async () => {
        const gl = await GitLabClient.create();
        return target.kind === 'pipeline'
          ? watchPipeline(gl, target.projectPath, target.id)
          : watchMr(gl, target.projectPath, target.id);
      });

      await refreshBadge();
      return result;
    },

    unwatch: async ({ key }) => {
      await stateLock.run(async () => {
        await storage.update('watches', (all) => {
          delete all[key];
        });
        await storage.update('pipelineWatches', (all) => {
          delete all[key];
        });
      });

      await refreshBadge();
    },

    mutePipeline: async ({ key, muted }) => {
      await stateLock.run(async () => {
        await storage.update('pipelineWatches', (all) => {
          if (all[key]) all[key].muted = muted;
        });
      });
    },

    promote: async ({ key }) => {
      await stateLock.run(() =>
        patchWatch(key, (watch) => {
          watch.promoteRequested = true;
          watch.log.push({ at: new Date().toISOString(), text: 'Promotion requested' });
        }),
      );

      void runLockedTick();
      return true;
    },

    patchWatch: async ({ key, patch }) => {
      await stateLock.run(() =>
        patchWatch(key, (watch) => {
          Object.assign(watch, patch);
        }),
      );
    },

    tick: () => runLockedTick(),

    signInOAuth: async () => {
      const me = await stateLock.run(async () => {
        await auth.signInWithOAuth();
        await storage.set('me', null);
        return ensureMe(await GitLabClient.create());
      });

      void runLockedTick();
      return me;
    },

    signInToken: async ({ token }) => {
      const me = await stateLock.run(async () => {
        await auth.signInWithToken(token);
        await session.clearExpectToken();
        await storage.set('me', null);
        return ensureMe(await GitLabClient.create());
      });

      void runLockedTick();
      return me;
    },

    signOut: async () => {
      await stateLock.run(() => auth.signOut());
      await refreshBadge();
    },

    readFeed: async ({ ids }) => {
      await stateLock.run(async () => {
        await storage.update('feed', (feed) =>
          feed.map((item) => (!ids || ids.includes(item.id) ? { ...item, read: true } : item)),
        );
      });
    },

    expectToken: async () => {
      await session.setExpectTokenUntil(Date.now() + EXPECT_TOKEN_TTL_MS);
      return true;
    },

    isExpectingToken: async () => {
      const until = await session.getExpectTokenUntil();
      if (until === null || until <= Date.now()) return false;

      return !(await storage.get('auth'));
    },

    setUiCollapsed: async ({ collapsed }) => {
      await stateLock.run(() => storage.set('uiCollapsed', collapsed));
    },

    updateSettings: ({ patch }) =>
      stateLock.run(() =>
        storage.update('settings', (current) => ({
          ...current,
          ...patch,
          pollMinutes:
            patch.pollMinutes !== undefined ? Math.max(0.5, Number(patch.pollMinutes) || 1) : current.pollMinutes,
        })),
      ),

    saveRule: ({ rule }) =>
      stateLock.run(() =>
        storage.update('rules', (rules) => {
          const exists = rules.some((r) => r.id === rule.id);
          return exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
        }),
      ),

    deleteRule: ({ id }) =>
      stateLock.run(() => storage.update('rules', (rules) => rules.filter((r) => r.id !== id))),

    saveRepo: ({ repo }) =>
      stateLock.run(() =>
        storage.update('repos', (repos) => {
          repos[repo.projectId] = repo;
        }),
      ),

    deleteRepo: ({ projectId }) =>
      stateLock.run(() =>
        storage.update('repos', (repos) => {
          delete repos[projectId];
        }),
      ),

    getHistory: async ({ limit }) => {
      const db = historyDb;
      const [mrs, pipelines] = await Promise.all([
        db.table('mrHistory').recent('by_finishedAt', limit),
        db.table('pipelineHistory').recent('by_finishedAt', limit),
      ]);
      return { mrs, pipelines };
    },

    testToast: async () => {
      const { baseUrl } = await storage.get('settings');

      await stateLock.run(() =>
        notifications.show({
          title: '✅ Test notification',
          message: 'Toasts on GitLab pages will appear in this corner.',
          url: baseUrl,
          severity: 'success',
        }),
      );
    },
  };
}
