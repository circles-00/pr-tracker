import { GitLabClient, GitLabError } from '../api/gitlab';
import { bumpHistoryRevision, historyDb } from '../platform/history-db';
import { notifications } from '../platform/notifications';
import { storage } from '../platform/storage';
import {
  DEFAULT_NOTIFY,
  FAILED_PIPELINE_STATUSES,
  FINISHED_STAGES,
  STALE_AFTER_MS,
} from '../shared/constants';
import { describeWatch } from '../shared/format';
import { ruleMatches } from '../shared/rules';
import type { AddResult, RepoConfig, Watch } from '../shared/types';
import { getOrDetectRepoConfig } from './repo-config';
import { createWatch, relatePipeline } from './watch-factory';

const TRANSIENT_MERGE_STATUSES: ReadonlySet<string> = new Set([
  'checking',
  'unchecked',
  'preparing',
  'approvals_syncing',
  'ci_must_pass',
  'ci_still_running',
  'mergeable',
]);

const BLOCKED_REASONS: Record<string, string> = {
  not_approved: 'needs approval',
  requested_changes: 'changes requested',
  conflict: 'has merge conflicts',
  need_rebase: 'needs a rebase',
  draft_status: 'is a draft',
  discussions_not_resolved: 'has unresolved threads',
  blocked_status: 'is blocked by another MR',
  external_status_checks: 'external status checks failing',
  jira_association_missing: 'missing Jira issue',
  not_open: 'is not open',
};

const shortSha = (sha?: string): string => sha?.slice(0, 8) ?? '?';

function snippetOf(body: string, maxLen = 120): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen - 1)}…` : collapsed;
}

async function checkOpenThreads(gl: GitLabClient, watch: Watch): Promise<void> {
  const { settings, me } = await storage.getMany(['settings', 'me']);
  if (!settings.notifyNewThreads) return;

  const discussions = await gl.mrDiscussions(watch.projectId, watch.iid);

  for (const discussion of discussions) {
    if (discussion.individual_note) continue;

    const openNote = discussion.notes.find((n) => !n.system && n.resolvable && !n.resolved);
    if (!openNote) continue;
    if (me && openNote.author.username === me.username) continue;

    const preview = snippetOf(openNote.body);
    await notifications.notifyWatch(
      watch,
      'threads',
      `thread-${discussion.id}`,
      '💬 New open thread',
      preview ? `@${openNote.author.username}: ${preview}` : `Opened by @${openNote.author.username}`,
      `${watch.webUrl}#note_${openNote.id}`,
      { severity: 'warning' },
    );
  }
}

async function finishWatch(watch: Watch, pipelineUrl: string): Promise<void> {
  watch.stage = 'done';
  await notifications.notifyWatch(
    watch,
    'staging',
    'staging',
    '✅ On staging',
    `Pipeline #${watch.pipeline?.id} passed.`,
    pipelineUrl,
    { severity: 'success' },
  );
}

async function stepOpen(gl: GitLabClient, watch: Watch, cfg: RepoConfig): Promise<void> {
  const mr = await gl.mr(watch.projectId, watch.iid);

  watch.title = mr.title;
  watch.sourceBranch = mr.source_branch;
  watch.targetBranch = mr.target_branch;
  relatePipeline(watch, mr.head_pipeline?.id);

  if (mr.state === 'closed') {
    watch.stage = 'closed';
    await notifications.notifyWatch(watch, 'failures', 'closed', '❌ MR closed', 'Closed without merging.', watch.webUrl, {
      severity: 'error',
    });
    return;
  }

  if (mr.state !== 'merged') {
    const pipeline = mr.head_pipeline;
    if (pipeline && FAILED_PIPELINE_STATUSES.has(pipeline.status)) {
      await notifications.notifyWatch(
        watch,
        'failures',
        `mr-pipe-${pipeline.id}-${pipeline.status}`,
        '❌ MR pipeline failed',
        `Pipeline #${pipeline.id} ${pipeline.status}.`,
        pipeline.web_url,
        { severity: 'error' },
      );
    }

    await checkOpenThreads(gl, watch);
    return;
  }

  watch.mergeSha = mr.merge_commit_sha ?? mr.squash_commit_sha ?? mr.sha;
  watch.mergedAt = new Date().toISOString();

  if (cfg.promotion && mr.target_branch === cfg.promotion.from) {
    watch.stage = 'in_develop';

    const next =
      watch.autoPromote === 'on'
        ? `Opening ${cfg.promotion.from} → ${cfg.promotion.to} with auto-merge…`
        : watch.autoPromote === 'ask'
          ? `Promote to ${cfg.promotion.to}?`
          : `Waiting for someone to promote to ${cfg.promotion.to}.`;

    await notifications.notifyWatch(watch, 'merged', 'merged', `Merged into ${mr.target_branch}`, next, watch.webUrl, {
      severity: 'info',
      promoteButton: watch.autoPromote === 'ask',
    });
    return;
  }

  if (mr.target_branch === cfg.deployBranch) {
    watch.stage = 'on_master';
    watch.masterSha = watch.mergeSha;

    await notifications.notifyWatch(
      watch,
      'masterMerged',
      'merged',
      `Merged into ${cfg.deployBranch}`,
      'Waiting for the pipeline…',
      watch.webUrl,
      { severity: 'info' },
    );
    return;
  }

  watch.stage = 'done';
  watch.log.push({
    at: new Date().toISOString(),
    text: `Merged into ${mr.target_branch} (not a staging path, stopped tracking)`,
  });
}

async function stepInDevelop(gl: GitLabClient, watch: Watch, cfg: RepoConfig): Promise<void> {
  if (!cfg.promotion) {
    watch.stage = 'on_master';
    watch.masterSha = watch.mergeSha;
    return;
  }

  const mergeSha = watch.mergeSha;
  if (!mergeSha) return;

  const promo = cfg.promotion;
  const target = await gl.branch(watch.projectId, promo.to);

  if (await gl.isAncestor(watch.projectId, mergeSha, target.commit.id)) {
    watch.stage = 'on_master';
    watch.masterSha = target.commit.id;

    await notifications.notifyWatch(
      watch,
      'masterMerged',
      'master-merged',
      `Merged into ${promo.to}`,
      'Waiting for the pipeline…',
      watch.webUrl,
      { severity: 'info' },
    );
    return;
  }

  const [open] = await gl.openMrsBetween(watch.projectId, promo.from, promo.to);

  if (open) {
    if (!(await gl.isAncestor(watch.projectId, mergeSha, open.sha))) return;

    watch.promotion = {
      iid: open.iid,
      webUrl: open.web_url,
      autoMergeSet: Boolean(open.merge_when_pipeline_succeeds),
    };
    watch.stage = 'promotion_open';

    await notifications.notifyWatch(
      watch,
      'promotion',
      `promo-${open.iid}`,
      `${promo.from} → ${promo.to} MR found`,
      `!${open.iid} includes your change.`,
      open.web_url,
      { severity: 'info' },
    );
    return;
  }

  if (watch.autoPromote !== 'on' && !watch.promoteRequested) return;

  try {
    const created = await gl.createMr(watch.projectId, {
      source_branch: promo.from,
      target_branch: promo.to,
      title: `Release: ${promo.from} → ${promo.to}`,
      description: `Opened automatically by PR Tracker after !${watch.iid} was merged.`,
      remove_source_branch: false,
    });

    gl.clearCache();
    watch.promotion = { iid: created.iid, webUrl: created.web_url, autoMergeSet: false };
    watch.stage = 'promotion_open';

    await notifications.notifyWatch(
      watch,
      'promotion',
      `promo-${created.iid}`,
      `Opened ${promo.from} → ${promo.to}`,
      `!${created.iid} created, enabling auto-merge…`,
      created.web_url,
      { severity: 'info', action: true },
    );
  } catch (err) {
    // 409 means another promotion MR was opened concurrently; next tick picks it up.
    if (err instanceof GitLabError && err.status === 409) return;
    throw err;
  }
}

async function stepPromotionOpen(gl: GitLabClient, watch: Watch, cfg: RepoConfig): Promise<void> {
  const promo = watch.promotion;
  if (!promo) {
    watch.stage = 'in_develop';
    return;
  }

  const mr = await gl.mr(watch.projectId, promo.iid);
  relatePipeline(watch, mr.head_pipeline?.id);

  if (mr.state === 'merged') {
    watch.masterSha = mr.merge_commit_sha ?? mr.squash_commit_sha ?? mr.sha;
    watch.stage = 'on_master';

    await notifications.notifyWatch(
      watch,
      'masterMerged',
      'master-merged',
      `Merged into ${cfg.deployBranch}`,
      `!${mr.iid} merged, waiting for the pipeline…`,
      mr.web_url,
      { severity: 'info' },
    );
    return;
  }

  if (mr.state === 'closed') {
    await notifications.notifyWatch(
      watch,
      'failures',
      `promo-closed-${mr.iid}`,
      '❌ Promotion MR closed',
      `!${mr.iid} was closed without merging.`,
      mr.web_url,
      { severity: 'error' },
    );

    watch.promotion = undefined;
    watch.stage = 'in_develop';
    return;
  }

  promo.autoMergeSet = Boolean(mr.merge_when_pipeline_succeeds);

  const pipeline = mr.head_pipeline;
  if (pipeline && FAILED_PIPELINE_STATUSES.has(pipeline.status)) {
    await notifications.notifyWatch(
      watch,
      'failures',
      `promo-pipe-${pipeline.id}-${pipeline.status}`,
      '❌ Promotion pipeline failed',
      `!${mr.iid} pipeline #${pipeline.id} ${pipeline.status}.`,
      pipeline.web_url,
      { severity: 'error' },
    );
  }

  const wantsAutoMerge = watch.autoPromote === 'on' || Boolean(watch.promoteRequested);
  if (!wantsAutoMerge || promo.autoMergeSet) return;

  try {
    const res = await gl.setAutoMerge(watch.projectId, mr.iid, mr.sha);
    gl.clearCache();

    promo.autoMergeSet = Boolean(res.merge_when_pipeline_succeeds) || res.state === 'merged';
    promo.blockedReason = undefined;

    if (promo.autoMergeSet) {
      await notifications.notifyWatch(
        watch,
        'promotion',
        `automerge-${mr.iid}`,
        'Auto-merge enabled',
        `!${mr.iid} will merge when its pipeline passes.`,
        mr.web_url,
        { severity: 'info', action: true },
      );
    }
  } catch (err) {
    if (!(err instanceof GitLabError) || ![401, 403, 405, 406, 409, 422].includes(err.status)) {
      throw err;
    }

    const status = mr.detailed_merge_status ?? 'unknown';
    if (err.status !== 403 && TRANSIENT_MERGE_STATUSES.has(status)) return;

    const reason = err.status === 403 ? 'you lack permission to merge' : (BLOCKED_REASONS[status] ?? status);
    promo.blockedReason = reason;

    await notifications.notifyWatch(
      watch,
      'failures',
      `blocked-${mr.iid}-${status}-${err.status}`,
      '⚠️ Auto-merge blocked',
      `!${mr.iid} ${reason}.`,
      mr.web_url,
      { severity: 'warning', action: true },
    );
  }
}

async function stepOnMaster(gl: GitLabClient, watch: Watch, cfg: RepoConfig): Promise<void> {
  const masterSha = watch.masterSha ?? watch.mergeSha;
  if (!masterSha) return;

  const [pipe] = await gl.pipelines(watch.projectId, { ref: cfg.deployBranch, sha: masterSha });

  if (pipe) {
    watch.pipeline = { id: pipe.id, webUrl: pipe.web_url, status: pipe.status };
    relatePipeline(watch, pipe.id);

    if (pipe.status === 'success') {
      await finishWatch(watch, pipe.web_url);
      return;
    }

    if (FAILED_PIPELINE_STATUSES.has(pipe.status)) {
      await notifications.notifyWatch(
        watch,
        'failures',
        `master-pipe-${pipe.id}-${pipe.status}`,
        `❌ ${cfg.deployBranch} pipeline ${pipe.status}`,
        `Pipeline #${pipe.id} for ${shortSha(masterSha)}. Still watching in case it's retried.`,
        pipe.web_url,
        { severity: 'error' },
      );
    } else if (pipe.status === 'manual') {
      await notifications.notifyWatch(
        watch,
        'failures',
        `master-pipe-${pipe.id}-manual`,
        `⏸ ${cfg.deployBranch} pipeline waiting`,
        `Pipeline #${pipe.id} is waiting on a manual job.`,
        pipe.web_url,
        { severity: 'warning' },
      );
    }
  }

  const [latestOk] = await gl.pipelines(watch.projectId, {
    ref: cfg.deployBranch,
    status: 'success',
    per_page: 1,
  });

  if (
    latestOk &&
    latestOk.id !== pipe?.id &&
    watch.mergeSha &&
    (await gl.isAncestor(watch.projectId, watch.mergeSha, latestOk.sha))
  ) {
    watch.pipeline = { id: latestOk.id, webUrl: latestOk.web_url, status: latestOk.status };
    relatePipeline(watch, latestOk.id);
    await finishWatch(watch, latestOk.web_url);
  }
}

export async function advanceWatch(gl: GitLabClient, watch: Watch): Promise<RepoConfig> {
  const cfg = await getOrDetectRepoConfig(gl, watch.projectId, watch.projectPath);

  for (let i = 0; i < 4; i++) {
    const before = watch.stage;

    switch (watch.stage) {
      case 'open':
        await stepOpen(gl, watch, cfg);
        break;
      case 'in_develop':
        await stepInDevelop(gl, watch, cfg);
        break;
      case 'promotion_open':
        await stepPromotionOpen(gl, watch, cfg);
        break;
      case 'on_master':
        await stepOnMaster(gl, watch, cfg);
        break;
      default:
        return cfg;
    }

    if (watch.stage === before) break;
  }

  if (watch.stage === 'in_develop' || watch.stage === 'promotion_open' || watch.stage === 'on_master') {
    const referenceTime = watch.mergedAt ?? watch.createdAt;
    if (Date.now() - Date.parse(referenceTime) > STALE_AFTER_MS) {
      watch.stage = 'stale';
      watch.log.push({
        at: new Date().toISOString(),
        text: 'Gave up after 7 days without reaching staging',
      });
    }
  }

  return cfg;
}

export async function catchUpWatch(
  gl: GitLabClient,
  watch: Watch,
): Promise<{ finished: boolean; repo?: RepoConfig }> {
  watch.catchingUp = true;
  let repo: RepoConfig | undefined;

  try {
    repo = await advanceWatch(gl, watch);
  } finally {
    delete watch.catchingUp;
  }

  const timestamp = new Date().toISOString();
  watch.updatedAt = timestamp;

  if (!FINISHED_STAGES.has(watch.stage)) return { finished: false, repo };

  watch.finishedAt = timestamp;
  return { finished: true, repo };
}

export async function watchMr(gl: GitLabClient, projectPath: string, iid: number): Promise<AddResult> {
  const project = await gl.project(projectPath);
  const mr = await gl.mr(project.id, iid);
  const key = `${project.id}!${iid}`;
  const { watches, repos, rules } = await storage.getMany(['watches', 'repos', 'rules']);

  if (watches[key]) {
    watches[key].muted = false;
    await storage.set('watches', watches);
    return {
      key,
      finished: false,
      message: `Already watching. ${describeWatch(watches[key], repos[project.id])}`,
    };
  }

  const matchedRule = rules.find((r) => r.enabled && ruleMatches(r, mr, project.path_with_namespace));
  const watch = createWatch(mr, project.path_with_namespace, {
    ruleId: null,
    notify: matchedRule?.notify ?? DEFAULT_NOTIFY,
    autoPromote: matchedRule?.autoPromote ?? 'ask',
  });

  await historyDb.table('mrHistory').delete(key);

  let finished = false;
  let repo = repos[project.id];

  try {
    const res = await catchUpWatch(gl, watch);
    finished = res.finished;
    repo = res.repo ?? repo;
  } catch (err) {
    console.warn('[pr-tracker] catch-up failed, will retry on next check', err);
  }

  if (finished) {
    await Promise.all([historyDb.table('mrHistory').put(watch), historyDb.table('seen').put({ key })]);
    await bumpHistoryRevision();
  } else {
    await storage.update('watches', (all) => {
      all[key] = watch;
    });
  }

  return { key, finished, message: describeWatch(watch, repo) };
}
