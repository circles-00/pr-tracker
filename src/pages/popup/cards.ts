import { bus } from '../../platform/messaging';
import { stageText, type Tone } from '../../shared/format';
import type { AutoPromote, PipelineWatch, RepoConfig, Stage, Watch } from '../../shared/types';
import { h } from '../shared/dom';

const STEPS_PROMO = ['Open', 'develop', 'Promotion', 'master', 'Staging'];
const STEPS_DIRECT = ['Open', 'master', 'Staging'];

const STEP_INDEX_PROMO: Record<Stage, number> = {
  open: 0,
  in_develop: 1,
  promotion_open: 2,
  on_master: 4,
  done: 5,
  closed: 0,
  stale: 4,
};

const STEP_INDEX_DIRECT: Record<Stage, number> = {
  open: 0,
  in_develop: 1,
  promotion_open: 1,
  on_master: 2,
  done: 3,
  closed: 0,
  stale: 2,
};

export const PIPELINE_TONES: Record<string, Tone> = {
  success: 'ok',
  failed: 'bad',
  canceled: 'warn',
  skipped: 'warn',
  manual: 'warn',
};

function progressBar(watch: Watch, repo?: RepoConfig): HTMLElement {
  const promo = repo ? Boolean(repo.promotion && watch.targetBranch === repo.promotion.from) : true;
  const labels = promo ? STEPS_PROMO : STEPS_DIRECT;
  const idx = (promo ? STEP_INDEX_PROMO : STEP_INDEX_DIRECT)[watch.stage];
  const tone = stageText(watch, repo).tone;
  const deployBranch = repo?.deployBranch ?? 'master';

  const bars = labels.map((_, i) => {
    const cls = i < idx ? 'done' : i === idx ? (tone === 'bad' ? 'bad' : 'now') : '';
    return h('span', { class: cls });
  });

  const stepLabels = labels.map((label) => {
    const display =
      promo && repo?.promotion
        ? label.replace('develop', repo.promotion.from).replace('master', repo.promotion.to)
        : label.replace('master', deployBranch);
    return h('span', {}, display);
  });

  return h('div', {}, h('div', { class: 'steps' }, bars), h('div', { class: 'step-labels' }, stepLabels));
}

export function watchCard(watch: Watch, repo?: RepoConfig): HTMLElement {
  const status = stageText(watch, repo);
  const promotable = repo
    ? Boolean(repo.promotion && watch.targetBranch === repo.promotion.from)
    : watch.targetBranch !== 'master' && watch.targetBranch !== 'main';
  const isPromotionMr =
    Boolean(repo?.promotion) &&
    watch.sourceBranch === repo?.promotion?.from &&
    watch.targetBranch === repo?.promotion?.to;
  const canPromote =
    promotable && watch.stage === 'in_develop' && !watch.promoteRequested && watch.autoPromote !== 'on';

  const promoteSelect = h(
    'select',
    {
      title: 'Auto-promote to deploy branch',
      onchange: (event) => {
        const value = (event.target as HTMLSelectElement).value as AutoPromote;
        void bus.send('patchWatch', { key: watch.key, patch: { autoPromote: value } });
      },
    },
    (['off', 'ask', 'on'] as AutoPromote[]).map((v) =>
      h('option', { value: v, selected: watch.autoPromote === v }, `Promote: ${v}`),
    ),
  );

  const links: (HTMLElement | string)[] = [];
  if (watch.promotion) {
    links.push(h('a', { href: watch.promotion.webUrl, target: '_blank' }, `promotion !${watch.promotion.iid}`));
  }

  if (watch.pipeline) {
    links.push(h('a', { href: watch.pipeline.webUrl, target: '_blank' }, `pipeline #${watch.pipeline.id}`));
  }

  const hasFooter = links.length > 0 || isPromotionMr || canPromote || promotable;

  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'row card-head' },
      h('a', { class: 'grow truncate', href: watch.webUrl, target: '_blank', title: watch.title }, h('strong', {}, watch.title)),
      h(
        'button',
        {
          type: 'button',
          class: 'ghost icon-btn',
          title: watch.muted ? 'Unmute' : 'Mute',
          onclick: () => void bus.send('patchWatch', { key: watch.key, patch: { muted: !watch.muted } }),
        },
        watch.muted ? '🔕' : '🔔',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'ghost danger icon-btn',
          title: 'Stop watching',
          onclick: () => void bus.send('unwatch', { key: watch.key }),
        },
        '✕',
      ),
    ),
    h(
      'div',
      { class: 'row small muted' },
      h('span', { class: 'grow truncate' }, `${watch.projectPath}!${watch.iid}`),
      h('span', { class: `pill ${status.tone}` }, status.text),
    ),
    progressBar(watch, repo),
    hasFooter &&
      h(
        'div',
        { class: 'row small mt-sm' },
        h('span', { class: 'grow muted' }, ...links.flatMap((l, i) => (i ? [' · ', l] : [l]))),
        isPromotionMr && h('span', { class: 'pill' }, `${watch.sourceBranch} → ${watch.targetBranch}`),
        canPromote &&
          h(
            'button',
            {
              type: 'button',
              class: 'primary small',
              onclick: () => void bus.send('promote', { key: watch.key }),
            },
            'Promote now',
          ),
        promotable && promoteSelect,
      ),
  );
}

export function pipelineCard(watch: PipelineWatch): HTMLElement {
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'row card-head' },
      h('a', { class: 'grow truncate', href: watch.webUrl, target: '_blank', title: watch.title }, h('strong', {}, `Pipeline #${watch.pipelineId}`)),
      h(
        'button',
        {
          type: 'button',
          class: 'ghost icon-btn',
          title: watch.muted ? 'Unmute' : 'Mute',
          onclick: () => void bus.send('mutePipeline', { key: watch.key, muted: !watch.muted }),
        },
        watch.muted ? '🔕' : '🔔',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'ghost danger icon-btn',
          title: 'Stop watching',
          onclick: () => void bus.send('unwatch', { key: watch.key }),
        },
        '✕',
      ),
    ),
    h(
      'div',
      { class: 'row small muted' },
      h('span', { class: 'grow truncate' }, `${watch.projectPath} · ${watch.ref} · ${watch.title}`),
      h('span', { class: `pill ${PIPELINE_TONES[watch.status] ?? ''}` }, watch.status),
    ),
  );
}
