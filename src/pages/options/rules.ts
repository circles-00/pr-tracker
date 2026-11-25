import { bus } from '../../platform/messaging';
import { storage } from '../../platform/storage';
import { createDefaultRule } from '../../shared/rules';
import type { AutoPromote, NotifyPrefs, Rule } from '../../shared/types';
import { h } from '../shared/dom';
import { flashSaved } from './flash';

const NOTIFY_LABELS: [keyof NotifyPrefs, string][] = [
  ['merged', 'Merged into promotion branch'],
  ['promotion', 'Promotion MR opened / auto-merge on'],
  ['masterMerged', 'Merged into deploy branch'],
  ['staging', '✅ On staging'],
  ['failures', '❌ Failures / blocked'],
];

const PROMOTE_LABELS: Record<AutoPromote, string> = {
  off: 'Off: just watch',
  ask: 'Ask: notification with “Promote now”',
  on: 'On: open promotion MR and set auto-merge',
};

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function ruleCard(rule: Rule): HTMLElement {
  const nameInput = h('input', { type: 'text', value: rule.name });
  const authorsInput = h('input', { type: 'text', value: rule.authors.join(', '), placeholder: 'me, someone' });
  const reposInput = h('input', { type: 'text', value: rule.repos.join(', '), placeholder: '*  or  my-group/*, my-group/app' });
  const targetsInput = h('input', { type: 'text', value: rule.targetBranches.join(', '), placeholder: 'any' });
  const enabledInput = h('input', { type: 'checkbox', checked: rule.enabled });

  const promoteSelect = h(
    'select',
    {},
    (Object.keys(PROMOTE_LABELS) as AutoPromote[]).map((v) =>
      h('option', { value: v, selected: rule.autoPromote === v }, PROMOTE_LABELS[v]),
    ),
  );

  const notifyInputs: Record<keyof NotifyPrefs, HTMLInputElement> = {
    merged: h('input', { type: 'checkbox', checked: rule.notify.merged }),
    promotion: h('input', { type: 'checkbox', checked: rule.notify.promotion }),
    masterMerged: h('input', { type: 'checkbox', checked: rule.notify.masterMerged }),
    staging: h('input', { type: 'checkbox', checked: rule.notify.staging }),
    failures: h('input', { type: 'checkbox', checked: rule.notify.failures }),
  };

  const actionsEl = h('div', { class: 'row' });

  const save = async () => {
    const updated: Rule = {
      ...rule,
      name: nameInput.value.trim() || 'Rule',
      enabled: enabledInput.checked,
      authors: splitList(authorsInput.value),
      repos: splitList(reposInput.value),
      targetBranches: splitList(targetsInput.value),
      autoPromote: promoteSelect.value as AutoPromote,
      notify: {
        merged: notifyInputs.merged.checked,
        promotion: notifyInputs.promotion.checked,
        masterMerged: notifyInputs.masterMerged.checked,
        staging: notifyInputs.staging.checked,
        failures: notifyInputs.failures.checked,
      },
    };

    await bus.send('saveRule', { rule: updated });
    flashSaved(actionsEl);
  };

  actionsEl.append(
    h('button', { type: 'button', class: 'primary', onclick: () => void save() }, 'Save'),
    h('button', { type: 'button', class: 'danger', onclick: () => void bus.send('deleteRule', { id: rule.id }) }, 'Delete'),
  );

  return h(
    'div',
    { class: 'card stack' },
    h('div', { class: 'row' }, h('label', { class: 'check' }, enabledInput, 'Enabled'), nameInput),
    h('div', { class: 'field' }, h('label', {}, 'Authors'), authorsInput),
    h('div', { class: 'field' }, h('label', {}, 'Repos (globs)'), reposInput),
    h('div', { class: 'field' }, h('label', {}, 'Target branches'), targetsInput),
    h('div', { class: 'field' }, h('label', {}, 'Auto-promote'), promoteSelect),
    h(
      'div',
      { class: 'field' },
      h('label', {}, 'Notify on'),
      h('div', {}, NOTIFY_LABELS.map(([k, label]) => h('label', { class: 'check' }, notifyInputs[k], label))),
    ),
    h(
      'div',
      { class: 'small muted' },
      `Watches open MRs from the last 7 days and any created after ${new Date(rule.createdAt).toLocaleString()}.`,
    ),
    actionsEl,
  );
}

export async function renderRules(container: HTMLElement): Promise<void> {
  const rules = await storage.get('rules');

  container.replaceChildren(
    h(
      'div',
      { class: 'row' },
      h('h2', { class: 'grow section-heading' }, 'Rules'),
      h(
        'button',
        { type: 'button', onclick: () => void bus.send('saveRule', { rule: createDefaultRule('New rule') }) },
        '+ Add rule',
      ),
    ),
    h('div', { class: 'small muted' }, 'MRs matching any enabled rule are watched automatically. “me” means the signed-in account.'),
    ...(rules.length
      ? rules.map(ruleCard)
      : [h('div', { class: 'muted' }, 'No rules. You can still watch MRs from the 🔔 button on GitLab.')]),
  );
}
