import type { GitLabClient } from '../api/gitlab';
import { historyDb } from '../platform/history-db';
import { storage } from '../platform/storage';
import { STALE_AFTER_MS } from '../shared/constants';
import { ruleMatches } from '../shared/rules';
import { projectPathOf } from '../shared/target';
import type { GitLabMergeRequest, Me, Watch } from '../shared/types';
import { createWatch } from './watch-factory';

export async function discoverMrs(
  gl: GitLabClient,
  me: Me,
  watches: Record<string, Watch>,
): Promise<void> {
  const { rules: allRules, lastDiscovery } = await storage.getMany(['rules', 'lastDiscovery']);
  const rules = allRules.filter((r) => r.enabled);
  if (!rules.length) return;

  const seenTable = historyDb.table('seen');
  const historyTable = historyDb.table('mrHistory');
  const newlySeen: { key: string }[] = [];
  const startedAt = new Date().toISOString();

  for (const rule of rules) {
    const authors = [
      ...new Set(rule.authors.map((a) => (a.trim() === 'me' ? me.username : a.trim())).filter(Boolean)),
    ];

    for (const author of authors) {
      const since =
        lastDiscovery && lastDiscovery > rule.createdAt
          ? new Date(Date.parse(lastDiscovery) - 10 * 60_000).toISOString()
          : undefined;

      const queries = [
        gl.searchMrs({ author_username: author, created_after: rule.createdAt, updated_after: since }),
      ];

      if (!lastDiscovery) {
        const openSince = new Date(Date.now() - STALE_AFTER_MS).toISOString();
        queries.push(gl.searchMrs({ author_username: author, state: 'opened', updated_after: openSince }));
      }

      const merged = new Map<string, GitLabMergeRequest>();
      for (const mr of (await Promise.all(queries)).flat()) {
        merged.set(`${mr.project_id}!${mr.iid}`, mr);
      }

      for (const [key, mr] of merged) {
        if (mr.state === 'closed' || watches[key]) continue;
        if ((await seenTable.has(key)) || (await historyTable.has(key))) continue;

        const path = projectPathOf(mr);
        if (!ruleMatches(rule, mr, path)) continue;

        watches[key] = createWatch(mr, path, {
          ruleId: rule.id,
          notify: rule.notify,
          autoPromote: rule.autoPromote,
        });
        newlySeen.push({ key });
      }
    }
  }

  await seenTable.putMany(newlySeen);
  await storage.set('lastDiscovery', startedAt);
}
