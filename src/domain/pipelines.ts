import { AuthMissingError, type GitLabClient } from '../api/gitlab';
import { bumpHistoryRevision, historyDb } from '../platform/history-db';
import { notifications } from '../platform/notifications';
import { storage } from '../platform/storage';
import { FINISHED_PIPELINE_STATUSES } from '../shared/constants';
import type { AddResult, PipelineWatch } from '../shared/types';

const DONE_TEXT: Record<string, string> = {
  success: '✅ Pipeline already passed',
  failed: '❌ Pipeline already failed',
  canceled: 'Pipeline was already canceled',
  skipped: 'Pipeline was already skipped',
};

export async function watchPipeline(
  gl: GitLabClient,
  projectPath: string,
  pipelineId: number,
): Promise<AddResult> {
  const project = await gl.project(projectPath);
  const key = `${project.id}#${pipelineId}`;
  const all = await storage.get('pipelineWatches');

  if (all[key]) {
    all[key].muted = false;
    await storage.set('pipelineWatches', all);
    return { key, finished: false, message: `Already watching, pipeline is ${all[key].status}.` };
  }

  const pipeline = await gl.pipeline(project.id, pipelineId);
  const commit = await gl.commit(project.id, pipeline.sha).catch(() => null);
  const timestamp = new Date().toISOString();

  const watch: PipelineWatch = {
    key,
    projectId: project.id,
    projectPath: project.path_with_namespace,
    pipelineId,
    ref: pipeline.ref,
    sha: pipeline.sha,
    title: commit?.title ?? pipeline.ref,
    webUrl: pipeline.web_url,
    status: pipeline.status,
    muted: false,
    sent: pipeline.status === 'manual' || FINISHED_PIPELINE_STATUSES.has(pipeline.status) ? [pipeline.status] : [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const historyTable = historyDb.table('pipelineHistory');
  await historyTable.delete(key);

  if (FINISHED_PIPELINE_STATUSES.has(pipeline.status)) {
    if (pipeline.status === 'failed') {
      const jobs = await gl.failedJobs(project.id, pipelineId).catch(() => []);
      watch.failedJobs = jobs.map((j) => j.name);
    }

    watch.finishedAt = timestamp;
    await historyTable.put(watch);
    await bumpHistoryRevision();

    const jobs = watch.failedJobs?.length ? ` (${watch.failedJobs.join(', ')})` : '';
    return { key, finished: true, message: `${DONE_TEXT[pipeline.status]}${jobs}, added to history.` };
  }

  all[key] = watch;
  await storage.set('pipelineWatches', all);

  return {
    key,
    finished: false,
    message:
      pipeline.status === 'manual'
        ? 'Watching. The pipeline is waiting on a manual job.'
        : `Watching. Pipeline is ${pipeline.status}.`,
  };
}

async function advancePipeline(gl: GitLabClient, watch: PipelineWatch): Promise<void> {
  const pipeline = await gl.pipeline(watch.projectId, watch.pipelineId);
  watch.status = pipeline.status;

  if (pipeline.status === 'success') {
    await notifications.notifyPipeline(watch, 'success', '✅ Pipeline passed', watch.title, 'success');
    return;
  }

  if (pipeline.status === 'failed') {
    const jobs = await gl.failedJobs(watch.projectId, watch.pipelineId).catch(() => []);
    watch.failedJobs = jobs.map((j) => j.name);

    await notifications.notifyPipeline(
      watch,
      'failed',
      '❌ Pipeline failed',
      jobs.length ? `Failed: ${watch.failedJobs.join(', ')}` : watch.title,
      'error',
    );
    return;
  }

  if (pipeline.status === 'canceled' || pipeline.status === 'skipped') {
    await notifications.notifyPipeline(watch, pipeline.status, `⚪ Pipeline ${pipeline.status}`, watch.title, 'warning');
    return;
  }

  if (pipeline.status === 'manual') {
    await notifications.notifyPipeline(watch, 'manual', '⏸ Pipeline waiting', 'Waiting on a manual job.', 'warning');
  }
}

export async function tickPipelines(gl: GitLabClient): Promise<void> {
  const all = await storage.get('pipelineWatches');
  const finished: PipelineWatch[] = [];

  for (const watch of Object.values(all)) {
    try {
      await advancePipeline(gl, watch);
      watch.updatedAt = new Date().toISOString();
    } catch (err) {
      console.warn(`[pr-tracker] pipeline ${watch.key} failed`, err);
      if (err instanceof AuthMissingError) break;
    }

    if (FINISHED_PIPELINE_STATUSES.has(watch.status)) {
      watch.finishedAt = new Date().toISOString();
      finished.push(watch);
      delete all[watch.key];
    }
  }

  await storage.set('pipelineWatches', all);

  if (finished.length) {
    await historyDb.table('pipelineHistory').putMany(finished);
    await bumpHistoryRevision();
  }
}
