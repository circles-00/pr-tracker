import type { AutoPromote, GitLabMergeRequest, NotifyPrefs, Watch } from '../shared/types';

export function createWatch(
  mr: GitLabMergeRequest,
  projectPath: string,
  opts: { ruleId: string | null; notify: NotifyPrefs; autoPromote: AutoPromote },
): Watch {
  const timestamp = new Date().toISOString();
  return {
    key: `${mr.project_id}!${mr.iid}`,
    projectId: mr.project_id,
    projectPath,
    iid: mr.iid,
    title: mr.title,
    webUrl: mr.web_url,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    ruleId: opts.ruleId,
    notify: { ...opts.notify },
    autoPromote: opts.autoPromote,
    muted: false,
    stage: 'open',
    sent: [],
    log: [{ at: timestamp, text: opts.ruleId ? 'Picked up by rule' : 'Watching' }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function relatePipeline(watch: Watch, pipelineId?: number): void {
  if (!pipelineId) return;
  watch.relatedPipelines ??= [];
  if (!watch.relatedPipelines.includes(pipelineId)) {
    watch.relatedPipelines.push(pipelineId);
  }
}
