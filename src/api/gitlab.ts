import { storage } from '../platform/storage';
import type { GitLabApprovals, GitLabDiscussion, GitLabMergeRequest, GitLabPipeline, GitLabProject } from '../shared/types';
import { auth } from './auth';

export class GitLabError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'GitLabError';
  }
}

export class AuthMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthMissingError';
  }
}

type QueryValue = string | number | boolean | readonly string[] | undefined;
type Query = Record<string, QueryValue>;

function tryParseJson(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractErrorMessage(data: unknown, fallbackText: string): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (record.message !== undefined) return JSON.stringify(record.message);
    if (typeof record.error === 'string') return record.error;
  }

  return fallbackText.slice(0, 200) || 'Unknown error';
}

export class GitLabClient {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(private readonly baseUrl: string) {}

  static async create(): Promise<GitLabClient> {
    const settings = await storage.get('settings');
    return new GitLabClient(settings.baseUrl.replace(/\/+$/, ''));
  }

  private url(path: string, query?: Query): string {
    const u = new URL(`${this.baseUrl}/api/v4${path}`);

    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) u.searchParams.append(k, item);
      } else {
        u.searchParams.set(k, String(v));
      }
    }

    return u.toString();
  }

  private async request<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
    const url = this.url(path, query);

    const send = async (forceRefresh: boolean): Promise<{ res: Response; canRefresh: boolean }> => {
      const creds = await auth.getHeaders(forceRefresh);
      if (!creds) throw new AuthMissingError('Not signed in');

      const res = await fetch(url, {
        method,
        headers: { ...creds.headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });

      return { res, canRefresh: creds.canRefresh };
    };

    let { res, canRefresh } = await send(false);

    if (res.status === 401 && canRefresh) {
      ({ res } = await send(true));
    }

    if (res.status === 401) {
      await storage.set('authError', 'GitLab rejected the credentials. Sign in again.');
      throw new AuthMissingError('Unauthorized');
    }

    const text = await res.text();
    const data = tryParseJson(text);

    if (!res.ok) {
      throw new GitLabError(res.status, `${method} ${path} → ${res.status}: ${extractErrorMessage(data, text)}`, data);
    }

    return data as T;
  }

  clearCache(): void {
    this.cache.clear();
  }

  get<T>(path: string, query?: Query): Promise<T> {
    const key = this.url(path, query);

    if (!this.cache.has(key)) {
      const promise = this.request<T>('GET', path, query);
      promise.catch(() => this.cache.delete(key));
      this.cache.set(key, promise);
    }

    return this.cache.get(key) as Promise<T>;
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, undefined, body);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, undefined, body);
  }

  me() {
    return this.get<{ id: number; username: string; name: string; avatar_url: string }>('/user');
  }

  project(idOrPath: number | string) {
    return this.get<GitLabProject>(`/projects/${encodeURIComponent(idOrPath)}`);
  }

  mr(projectId: number, iid: number) {
    return this.get<GitLabMergeRequest>(`/projects/${projectId}/merge_requests/${iid}`);
  }

  mrDiscussions(projectId: number, iid: number) {
    return this.get<GitLabDiscussion[]>(`/projects/${projectId}/merge_requests/${iid}/discussions`, {
      per_page: 100,
    });
  }

  mrApprovals(projectId: number, iid: number) {
    return this.get<GitLabApprovals>(`/projects/${projectId}/merge_requests/${iid}/approvals`);
  }

  searchMrs(query: Query) {
    return this.get<GitLabMergeRequest[]>('/merge_requests', { scope: 'all', per_page: 100, ...query });
  }

  openMrsBetween(projectId: number, source: string, target: string) {
    return this.get<GitLabMergeRequest[]>(`/projects/${projectId}/merge_requests`, {
      state: 'opened',
      source_branch: source,
      target_branch: target,
    });
  }

  createMr(projectId: number, body: Record<string, unknown>) {
    return this.post<GitLabMergeRequest>(`/projects/${projectId}/merge_requests`, body);
  }

  setAutoMerge(projectId: number, iid: number, sha: string) {
    return this.put<GitLabMergeRequest>(`/projects/${projectId}/merge_requests/${iid}/merge`, {
      auto_merge: true,
      merge_when_pipeline_succeeds: true,
      should_remove_source_branch: false,
      sha,
    });
  }

  branch(projectId: number, name: string) {
    return this.get<{ name: string; commit: { id: string } }>(
      `/projects/${projectId}/repository/branches/${encodeURIComponent(name)}`,
    );
  }

  branchExists(projectId: number, name: string): Promise<boolean> {
    return this.branch(projectId, name).then(
      () => true,
      (err: unknown) => {
        if (err instanceof GitLabError && err.status === 404) return false;
        throw err;
      },
    );
  }

  async isAncestor(projectId: number, ancestor: string, descendant: string): Promise<boolean> {
    if (ancestor === descendant) return true;

    try {
      const res = await this.get<{ id: string }>(`/projects/${projectId}/repository/merge_base`, {
        'refs[]': [ancestor, descendant],
      });
      return res.id === ancestor;
    } catch (err) {
      if (err instanceof GitLabError && (err.status === 404 || err.status === 400)) return false;
      throw err;
    }
  }

  pipelines(projectId: number, query: Query) {
    return this.get<GitLabPipeline[]>(`/projects/${projectId}/pipelines`, { per_page: 20, ...query });
  }

  pipeline(projectId: number, pipelineId: number) {
    return this.get<GitLabPipeline>(`/projects/${projectId}/pipelines/${pipelineId}`);
  }

  failedJobs(projectId: number, pipelineId: number) {
    return this.get<{ name: string; stage: string }[]>(`/projects/${projectId}/pipelines/${pipelineId}/jobs`, {
      'scope[]': 'failed',
      per_page: 100,
    });
  }

  commit(projectId: number, sha: string) {
    return this.get<{ title: string }>(`/projects/${projectId}/repository/commits/${encodeURIComponent(sha)}`);
  }
}
