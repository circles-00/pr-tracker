export type Child = Node | string | null | undefined | false;

type EventHandlerMap = {
  [K in keyof HTMLElementEventMap as `on${K}`]?: (event: HTMLElementEventMap[K]) => unknown;
};

export interface ElementProps extends EventHandlerMap {
  class?: string;
  id?: string;
  title?: string;
  type?: string;
  href?: string;
  target?: string;
  src?: string;
  alt?: string;
  placeholder?: string;
  style?: string;
  min?: string;
  step?: string;
  value?: string;
  checked?: boolean;
  selected?: boolean;
  disabled?: boolean;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props) as [string, unknown][]) {
    if (val === undefined || val === null || val === false) continue;
    if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2), val as EventListener);
    } else if (key === 'value' && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLOptionElement)) {
      el.value = String(val);
    } else if (key === 'checked' && el instanceof HTMLInputElement) {
      el.checked = Boolean(val);
    } else if (key === 'selected' && el instanceof HTMLOptionElement) {
      el.selected = Boolean(val);
    } else if (key === 'disabled' && (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) {
      el.disabled = Boolean(val);
    } else {
      el.setAttribute(key, val === true ? '' : String(val));
    }
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) {
      el.append(child);
    }
  }
  return el;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}
