import { applicationsUrl, newTokenUrl, redirectUri } from '../../api/urls';
import { extension } from '../../platform/extension';
import { bus } from '../../platform/messaging';
import { storage } from '../../platform/storage';
import { h } from '../shared/dom';

function parseHttpsBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid GitLab URL (e.g. https://gitlab.com).');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('GitLab URL must use https://.');
  }

  return trimmed;
}

export async function renderConnection(container: HTMLElement): Promise<void> {
  const { settings, auth, me, authError } = await storage.getMany(['settings', 'auth', 'me', 'authError']);

  if (auth && me) {
    container.replaceChildren(
      h('h2', {}, 'GitLab account'),
      h(
        'div',
        { class: 'card row' },
        h('img', { class: 'avatar-lg', src: me.avatarUrl, alt: '' }),
        h(
          'div',
          { class: 'grow' },
          h('strong', {}, me.name),
          h(
            'div',
            { class: 'muted small' },
            `@${me.username} · ${settings.baseUrl} · ${auth.kind === 'oauth' ? 'OAuth' : 'access token'}`,
          ),
        ),
        h('button', { type: 'button', onclick: () => void bus.send('signOut') }, 'Sign out'),
      ),
      authError ? h('div', { class: 'banner' }, authError) : '',
    );
    return;
  }

  const baseUrlInput = h('input', { type: 'text', value: settings.baseUrl });
  const clientIdInput = h('input', { type: 'text', value: settings.oauthClientId, placeholder: 'Application ID' });
  const tokenInput = h('input', { type: 'password', placeholder: 'glpat-…' });
  const statusEl = h('div', { class: 'small' });

  const saveBaseSettings = async () => {
    const url = parseHttpsBaseUrl(baseUrlInput.value);
    const origin = new URL(url).origin;

    if (origin !== 'https://gitlab.com') {
      const granted = await extension.requestOriginPermission(origin);
      if (!granted) throw new Error(`Permission for ${origin} is needed to talk to your GitLab.`);
    }

    await bus.send('updateSettings', {
      patch: { baseUrl: url, oauthClientId: clientIdInput.value.trim() },
    });
  };

  const runAction = async (fn: () => Promise<unknown>) => {
    statusEl.textContent = 'Working…';
    statusEl.className = 'small';

    try {
      await saveBaseSettings();
      await fn();
      statusEl.textContent = '';
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : String(err);
      statusEl.className = 'small error-text';
    }
  };

  const redirect = redirectUri();
  const copyBtn = h(
    'button',
    {
      type: 'button',
      class: 'small',
      onclick: async (event) => {
        await navigator.clipboard.writeText(redirect);
        const btn = event.target as HTMLButtonElement;
        btn.textContent = 'Copied';
        setTimeout(() => {
          btn.textContent = 'Copy';
        }, 1500);
      },
    },
    'Copy',
  );

  container.replaceChildren(
    h('h2', {}, 'Connect GitLab'),
    authError ? h('div', { class: 'banner' }, authError) : '',
    h(
      'div',
      { class: 'card stack' },
      h('strong', {}, 'Option 1: Sign in with GitLab (OAuth)'),
      h(
        'ol',
        { class: 'small' },
        h(
          'li',
          {},
          'Open ',
          h('a', { href: applicationsUrl(baseUrlInput.value.trim() || settings.baseUrl), target: '_blank' }, 'GitLab → Applications ↗'),
          '.',
        ),
        h('li', {}, 'Click ', h('strong', {}, 'Add new application'), ' (top right of “Your applications”).'),
        h('li', {}, 'Name: ', h('code', {}, 'PR Tracker')),
        h('li', {}, 'Redirect URI: ', h('code', {}, redirect), ' ', copyBtn),
        h('li', {}, 'Untick ', h('strong', {}, 'Confidential'), '. Leave “Device authorization grant” unticked.'),
        h('li', {}, 'Scopes: tick ', h('code', {}, 'api'), '.'),
        h('li', {}, 'Click ', h('strong', {}, 'Save application'), ', copy the ', h('strong', {}, 'Application ID'), ' and paste it below.'),
      ),
      h(
        'div',
        { class: 'small muted' },
        'Already have a “PR Tracker” app? Click its ✏️, set the Callback URL to the Redirect URI above and save. It must match exactly.',
      ),
      h(
        'div',
        { class: 'row' },
        clientIdInput,
        h(
          'button',
          { type: 'button', class: 'primary', onclick: () => void runAction(() => bus.send('signInOAuth')) },
          'Sign in with GitLab',
        ),
      ),
    ),
    h(
      'div',
      { class: 'card stack' },
      h('strong', {}, 'Option 2: Personal access token'),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            type: 'button',
            onclick: () =>
              void runAction(async () => {
                await bus.send('expectToken');
                await extension.openTab(newTokenUrl(baseUrlInput.value.trim() || settings.baseUrl));
              }),
          },
          'Create token on GitLab ↗',
        ),
        h('span', { class: 'small muted' }, 'Opens with name and scope filled in. Click “Create”, then “Use token” in the banner.'),
      ),
      h(
        'div',
        { class: 'row' },
        tokenInput,
        h(
          'button',
          { type: 'button', onclick: () => void runAction(() => bus.send('signInToken', { token: tokenInput.value })) },
          'Save token',
        ),
      ),
    ),
    h(
      'details',
      {},
      h('summary', { class: 'small muted' }, 'Self-hosted GitLab'),
      h('div', { class: 'field mt-sm' }, h('label', {}, 'GitLab URL'), baseUrlInput),
    ),
    statusEl,
  );
}
