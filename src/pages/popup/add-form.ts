import { bus } from '../../platform/messaging';
import { parseTarget, type Target } from '../../shared/target';
import { h } from '../shared/dom';

export function addWatchForm(
  tabTarget: Target | null,
  tabState: 'unwatched' | 'active' | 'history',
  onAdded: (message: string) => void,
): HTMLElement {
  const input = h('input', { type: 'text', placeholder: 'Paste an MR or pipeline URL' });
  const errEl = h('div', { class: 'small error-text' });

  const add = async (target: Target) => {
    errEl.textContent = '';

    try {
      const result = await bus.send('watch', { target });
      input.value = '';
      onAdded(result.message);
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
    }
  };

  const tabName = tabTarget
    ? `${tabTarget.projectPath.split('/').pop()}${tabTarget.kind === 'mr' ? '!' : ' pipeline #'}${tabTarget.id}`
    : '';

  return h(
    'div',
    { class: 'stack' },
    tabTarget &&
      tabState === 'unwatched' &&
      h('button', { type: 'button', class: 'primary', onclick: () => void add(tabTarget) }, `🔔 Watch ${tabName}`),
    tabTarget &&
      tabState === 'history' &&
      h('button', { type: 'button', disabled: true }, `✓ Already watched ${tabName}`),
    h(
      'form',
      {
        class: 'row',
        onsubmit: (event) => {
          event.preventDefault();

          const parsed = parseTarget(input.value.trim());
          if (!parsed) {
            errEl.textContent = 'Paste a merge request or pipeline URL.';
            return;
          }

          void add(parsed);
        },
      },
      input,
      h('button', { type: 'submit', class: 'primary' }, 'Add'),
    ),
    errEl,
  );
}
