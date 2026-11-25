import { bus } from '../../platform/messaging';
import { storage } from '../../platform/storage';
import type { ToastPosition } from '../../shared/types';
import { h } from '../shared/dom';
import { flashSaved } from './flash';

const TOAST_POSITION_LABELS: Record<ToastPosition, string> = {
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
  'top-right': 'Top right',
  'top-left': 'Top left',
};

export async function renderGeneral(container: HTMLElement): Promise<void> {
  const settings = await storage.get('settings');

  const pollInput = h('input', {
    type: 'number',
    class: 'poll-input',
    min: '0.5',
    step: '0.5',
    value: String(settings.pollMinutes),
  });

  const pollRow = h('div', { class: 'row' }, pollInput, h('span', { class: 'muted' }, 'minutes'));
  pollRow.append(
    h(
      'button',
      {
        type: 'button',
        onclick: async () => {
          const pollMinutes = Math.max(0.5, Number(pollInput.value) || 1);
          await bus.send('updateSettings', { patch: { pollMinutes } });
          flashSaved(pollRow);
        },
      },
      'Save',
    ),
  );

  const toggle = (key: 'desktopNotifications' | 'pageToasts', label: string) =>
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: settings[key],
        onchange: (event) => {
          const checked = (event.target as HTMLInputElement).checked;
          void bus.send('updateSettings', { patch: { [key]: checked } });
        },
      }),
      label,
    );

  const positionRow = h(
    'div',
    { class: 'row' },
    h(
      'select',
      {
        disabled: !settings.pageToasts,
        onchange: async (event) => {
          const toastPosition = (event.target as HTMLSelectElement).value as ToastPosition;
          await bus.send('updateSettings', { patch: { toastPosition } });
          flashSaved(positionRow);
        },
      },
      (Object.keys(TOAST_POSITION_LABELS) as ToastPosition[]).map((pos) =>
        h('option', { value: pos, selected: settings.toastPosition === pos }, TOAST_POSITION_LABELS[pos]),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'small',
        onclick: async () => {
          await bus.send('testToast');
          flashSaved(positionRow, 'Sent');
        },
      },
      'Test toast',
    ),
  );

  container.replaceChildren(
    h('h2', {}, 'General'),
    h('div', { class: 'field' }, h('label', {}, 'Check every'), pollRow),
    h(
      'div',
      { class: 'field' },
      h('label', {}, 'Show notifications'),
      h('div', {}, toggle('desktopNotifications', 'System notifications'), toggle('pageToasts', 'Toasts on GitLab pages')),
    ),
    h('div', { class: 'field' }, h('label', {}, 'Toast position'), positionRow),
    h('div', { class: 'small muted' }, 'Unread notifications always appear at the top of the popup, and the badge shows how many.'),
  );
}
