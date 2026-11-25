import type { GitLabClient } from '../api/gitlab';
import { storage } from '../platform/storage';
import type { RepoConfig } from '../shared/types';

export async function getOrDetectRepoConfig(
  gl: GitLabClient,
  projectId: number,
  path: string,
): Promise<RepoConfig> {
  const repos = await storage.get('repos');
  if (repos[projectId]) return repos[projectId];

  const project = await gl.project(projectId);
  const [hasDevelop, hasMaster, hasMain] = await Promise.all([
    gl.branchExists(projectId, 'develop'),
    gl.branchExists(projectId, 'master'),
    gl.branchExists(projectId, 'main'),
  ]);

  const deployBranch = hasMaster ? 'master' : hasMain ? 'main' : project.default_branch;
  const config: RepoConfig = {
    projectId,
    path,
    deployBranch,
    promotion: hasDevelop && deployBranch !== 'develop' ? { from: 'develop', to: deployBranch } : null,
  };

  await storage.update('repos', (all) => {
    all[projectId] = config;
  });

  return config;
}
