import { bus } from '../../platform/messaging';
import { storage } from '../../platform/storage';
import type { RepoConfig } from '../../shared/types';
import { h } from '../shared/dom';
import { flashSaved } from './flash';

function repoRow(cfg: RepoConfig): HTMLElement {
  const deployInput = h('input', { type: 'text', value: cfg.deployBranch });
  const fromInput = h('input', { type: 'text', value: cfg.promotion?.from ?? '', placeholder: 'none' });
  const cell = h('td', {});

  const save = async () => {
    const deployBranch = deployInput.value.trim() || cfg.deployBranch;
    const fromBranch = fromInput.value.trim();

    await bus.send('saveRepo', {
      repo: {
        ...cfg,
        deployBranch,
        promotion: fromBranch ? { from: fromBranch, to: deployBranch } : null,
      },
    });
    flashSaved(cell);
  };

  cell.append(
    h('button', { type: 'button', onclick: () => void save() }, 'Save'),
    ' ',
    h(
      'button',
      {
        type: 'button',
        class: 'ghost',
        title: 'Forget and re-detect',
        onclick: () => void bus.send('deleteRepo', { projectId: cfg.projectId }),
      },
      '↺',
    ),
  );

  return h('tr', {}, h('td', {}, cfg.path), h('td', {}, fromInput), h('td', {}, deployInput), cell);
}

export async function renderRepos(container: HTMLElement): Promise<void> {
  const repos = Object.values(await storage.get('repos')).sort((a, b) => a.path.localeCompare(b.path));

  container.replaceChildren(
    h('h2', {}, 'Repositories'),
    h(
      'div',
      { class: 'small muted' },
      'Detected automatically the first time an MR in a repo is watched. Staging is reached when the deploy branch’s pipeline succeeds. Leave “promote from” empty for repos where MRs go straight to the deploy branch.',
    ),
    repos.length
      ? h(
          'table',
          {},
          h('tr', {}, h('th', {}, 'Repo'), h('th', {}, 'Promote from'), h('th', {}, 'Deploy branch'), h('th', {})),
          repos.map(repoRow),
        )
      : h('div', { class: 'muted small' }, 'None yet.'),
  );
}
