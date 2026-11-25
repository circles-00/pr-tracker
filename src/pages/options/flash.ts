import { h } from '../shared/dom';

export function flashSaved(el: HTMLElement, text = 'Saved'): void {
  const badge = h('span', { class: 'saved' }, text);
  el.append(badge);
  setTimeout(() => badge.remove(), 1800);
}
