import { DEFAULT_NOTIFY } from './constants';
import type { GitLabMergeRequest, Rule } from './types';

export function globToRegex(glob: string): RegExp {
  const escaped = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${escaped}$`, 'i');
}

export function ruleMatches(rule: Rule, mr: Pick<GitLabMergeRequest, 'target_branch'>, path: string): boolean {
  const repos = rule.repos.filter((r) => r.trim());
  if (repos.length > 0 && !repos.some((g) => globToRegex(g).test(path))) {
    return false;
  }

  const targets = rule.targetBranches.filter((t) => t.trim());
  if (targets.length > 0 && !targets.includes(mr.target_branch)) {
    return false;
  }

  return true;
}

export function createDefaultRule(name = 'All my MRs'): Rule {
  return {
    id: crypto.randomUUID(),
    name,
    enabled: true,
    authors: ['me'],
    repos: ['*'],
    targetBranches: [],
    notify: { ...DEFAULT_NOTIFY },
    autoPromote: 'ask',
    createdAt: new Date().toISOString(),
  };
}
