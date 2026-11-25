import { extension } from '../../platform/extension';
import { h } from '../shared/dom';

const REPO = 'circles-00/pr-tracker';
const REPO_URL = `https://github.com/${REPO}`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  const b = current.replace(/^v/, '').split('.').map((n) => Number(n) || 0);

  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }

  return false;
}

export function renderAbout(container: HTMLElement): void {
  const currentVersion = extension.getVersion();
  const statusEl = h('span', { class: 'small muted update-status' });

  const checkBtn = h(
    'button',
    {
      type: 'button',
      class: 'small',
      onclick: async () => {
        checkBtn.disabled = true;
        statusEl.textContent = 'Checking…';

        try {
          const res = await fetch(LATEST_RELEASE_API);
          if (!res.ok) throw new Error(`GitHub returned ${res.status}`);

          const release = (await res.json()) as GitHubRelease;
          if (!isNewerVersion(release.tag_name, currentVersion)) {
            statusEl.textContent = `Up to date (v${currentVersion})`;
            return;
          }

          statusEl.textContent = `Found ${release.tag_name}, requesting update…`;
          const check = await extension.requestUpdateCheck(3000);

          if (check.status === 'update_available') {
            statusEl.replaceChildren(
              `Update v${check.version ?? release.tag_name.replace(/^v/, '')} ready · `,
              h(
                'button',
                {
                  type: 'button',
                  class: 'primary small',
                  onclick: () => extension.reload(),
                },
                'Restart to apply',
              ),
            );
            return;
          }

          const crxAsset = release.assets.find((a) => a.name.endsWith('.crx'));
          statusEl.replaceChildren(
            `${release.tag_name} available · `,
            h(
              'a',
              { href: crxAsset?.browser_download_url ?? release.html_url, target: '_blank' },
              crxAsset ? 'Download .crx ↗' : 'View release ↗',
            ),
          );
        } catch {
          statusEl.textContent = 'Could not check for updates';
        } finally {
          checkBtn.disabled = false;
        }
      },
    },
    'Check for updates',
  );

  container.replaceChildren(
    h('h2', {}, 'About'),
    h(
      'div',
      { class: 'card stack' },
      h(
        'div',
        { class: 'row small muted' },
        h('span', { class: 'grow' }, `PR Tracker v${currentVersion}`),
        checkBtn,
        h('a', { href: `${REPO_URL}/releases`, target: '_blank' }, 'Releases ↗'),
        '·',
        h('a', { href: REPO_URL, target: '_blank' }, 'GitHub ↗'),
      ),
      statusEl,
    ),
  );
}
