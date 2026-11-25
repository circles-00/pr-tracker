import type { NotifySeverity, RepoConfig, Stage, Watch } from './types';

export type Tone = '' | 'ok' | 'warn' | 'bad';

export function severityToTone(severity: NotifySeverity): Tone {
  switch (severity) {
    case 'success':
      return 'ok';
    case 'error':
      return 'bad';
    case 'warning':
      return 'warn';
    default:
      return '';
  }
}

export function stageLabel(stage: Stage, repo?: RepoConfig): string {
  const promoFrom = repo?.promotion?.from ?? 'develop';
  const deployBranch = repo?.deployBranch ?? 'master';

  switch (stage) {
    case 'open':
      return 'waiting for merge';
    case 'in_develop':
      return `in ${promoFrom}`;
    case 'promotion_open':
      return 'promotion MR open';
    case 'on_master':
      return `${deployBranch} pipeline`;
    case 'done':
      return 'on staging';
    case 'closed':
      return 'closed';
    case 'stale':
      return 'stale';
  }
}

export function stageText(watch: Watch, repo?: RepoConfig): { text: string; tone: Tone } {
  const promoFrom = repo?.promotion?.from ?? 'develop';
  const deployBranch = repo?.deployBranch ?? 'master';

  switch (watch.stage) {
    case 'open':
      return { text: 'Waiting for merge', tone: '' };

    case 'in_develop':
      if (watch.autoPromote === 'off' && !watch.promoteRequested) {
        return { text: `In ${promoFrom} · waiting for promotion`, tone: '' };
      }

      if (watch.autoPromote === 'ask' && !watch.promoteRequested) {
        return { text: `In ${promoFrom} · promote?`, tone: 'warn' };
      }

      return { text: `In ${promoFrom} · promoting…`, tone: '' };

    case 'promotion_open':
      if (watch.promotion?.blockedReason) {
        return { text: `Promotion blocked: ${watch.promotion.blockedReason}`, tone: 'bad' };
      }

      return {
        text: watch.promotion?.autoMergeSet ? 'Promotion MR · auto-merge on' : 'Promotion MR open',
        tone: '',
      };

    case 'on_master': {
      const status = watch.pipeline?.status;
      if (status === 'failed' || status === 'canceled') {
        return { text: `${deployBranch} pipeline ${status}`, tone: 'bad' };
      }

      return {
        text: status ? `On ${deployBranch} · pipeline ${status}` : `On ${deployBranch} · waiting for pipeline`,
        tone: 'ok',
      };
    }

    case 'done':
      return { text: 'On staging', tone: 'ok' };
    case 'closed':
      return { text: 'Closed', tone: 'bad' };
    case 'stale':
      return { text: 'Gave up', tone: 'warn' };
  }
}

export function describeWatch(watch: Watch, repo?: RepoConfig): string {
  const promoFrom = repo?.promotion?.from ?? 'develop';
  const promoTo = repo?.promotion?.to ?? repo?.deployBranch ?? 'master';
  const deployBranch = repo?.deployBranch ?? 'master';

  switch (watch.stage) {
    case 'open':
      return 'Watching. You’ll be notified at each stage.';

    case 'in_develop':
      if (watch.autoPromote === 'on' || watch.promoteRequested) {
        return `Already merged into ${promoFrom}. Promoting to ${promoTo}…`;
      }

      if (watch.autoPromote === 'ask') {
        return `Already merged into ${promoFrom}. Use “Promote now” in the popup when ready.`;
      }

      return `Already merged into ${promoFrom}. Watching for promotion.`;

    case 'promotion_open':
      return `Already merged into ${promoFrom}, in promotion MR !${watch.promotion?.iid}. Watching.`;

    case 'on_master':
      return watch.pipeline
        ? `Already in ${deployBranch}, pipeline #${watch.pipeline.id} ${watch.pipeline.status}. Watching.`
        : `Already in ${deployBranch}. Waiting for the pipeline.`;

    case 'done':
      return '✅ Already on staging, added to history.';
    case 'closed':
      return 'This MR is closed, added to history.';
    case 'stale':
      return 'Merged over a week ago without reaching staging, added to history.';
  }
}

export function timeAgo(iso?: string): string {
  if (!iso) return '';

  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;

  return `${Math.round(seconds / 86400)}d ago`;
}
