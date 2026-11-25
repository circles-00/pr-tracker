import { extension } from '../../platform/extension';
import { h } from '../shared/dom';

const REPO_URL = 'https://github.com/circles-00/pr-tracker';

export function renderAbout(container: HTMLElement): void {
  const version = extension.getVersion();

  container.replaceChildren(
    h('h2', {}, 'About'),
    h(
      'div',
      { class: 'card row small muted' },
      h('span', { class: 'grow' }, `PR Tracker v${version}`),
      h('a', { href: `${REPO_URL}/releases`, target: '_blank' }, 'Releases ↗'),
      '·',
      h('a', { href: REPO_URL, target: '_blank' }, 'GitHub ↗'),
    ),
  );
}
