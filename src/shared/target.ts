import type { GitLabMergeRequest, Watch } from './types';

export type Target =
  | { kind: 'mr'; projectPath: string; id: number }
  | { kind: 'pipeline'; projectPath: string; id: number };

export function parseTarget(url: string): Target | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const match = parsed.pathname.match(/^\/(.+?)\/-\/(merge_requests|pipelines)\/(\d+)/);
  if (!match) return null;

  return {
    kind: match[2] === 'pipelines' ? 'pipeline' : 'mr',
    projectPath: decodeURIComponent(match[1]),
    id: Number(match[3]),
  };
}

export function coversPipeline(watch: Watch, projectPath: string, pipelineId: number): boolean {
  if (watch.projectPath !== projectPath) return false;

  return watch.pipeline?.id === pipelineId || Boolean(watch.relatedPipelines?.includes(pipelineId));
}

export function projectPathOf(mr: GitLabMergeRequest): string {
  if (mr.references?.full) return mr.references.full.split('!')[0];

  return new URL(mr.web_url).pathname.replace(/^\//, '').split('/-/')[0];
}
