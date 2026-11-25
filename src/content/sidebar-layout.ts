const SIDEBAR_SELECTORS = [
  '#super-sidebar',
  '.super-sidebar',
  '[data-testid="super-sidebar"]',
  'aside[aria-label="Primary navigation"]',
];

const CONTENT_FALLBACK_SELECTOR = '.content-wrapper, .page-with-super-sidebar > div, main';

export class SidebarLayoutTracker {
  private readonly followers = new Set<HTMLElement>();
  private readonly resizeObserver: ResizeObserver;
  private readonly mutationObserver: MutationObserver;
  private observedSidebars = new Set<Element>();
  private rafId: number | null = null;
  private started = false;

  constructor() {
    this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
    this.mutationObserver = new MutationObserver(() => {
      this.rebindSidebarObservers();
      this.scheduleUpdate();
    });
  }

  addFollower(el: HTMLElement): void {
    this.followers.add(el);
    if (!this.started) this.start();
    this.update();
  }

  removeFollower(el: HTMLElement): void {
    this.followers.delete(el);
    if (this.followers.size === 0) this.stop();
  }

  stop(): void {
    if (!this.started) return;

    this.started = false;
    window.removeEventListener('resize', this.handleResize);
    this.mutationObserver.disconnect();
    this.resizeObserver.disconnect();
    this.observedSidebars.clear();

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private start(): void {
    this.started = true;
    window.addEventListener('resize', this.handleResize, { passive: true });
    this.mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-expanded', 'hidden'],
    });
    this.rebindSidebarObservers();
  }

  private readonly handleResize = (): void => {
    this.scheduleUpdate();
  };

  private rebindSidebarObservers(): void {
    const found = new Set<Element>();

    for (const sel of SIDEBAR_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) found.add(el);
    }

    for (const prev of this.observedSidebars) {
      if (!found.has(prev)) this.resizeObserver.unobserve(prev);
    }

    for (const next of found) {
      if (!this.observedSidebars.has(next)) this.resizeObserver.observe(next);
    }

    this.observedSidebars = found;
  }

  private scheduleUpdate(): void {
    if (this.rafId !== null) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.update();
    });
  }

  update(): void {
    if (this.followers.size === 0) return;

    let edge = 0;

    for (const sel of SIDEBAR_SELECTORS) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.left < window.innerWidth / 3) {
          edge = Math.max(edge, rect.right);
        }
      }
    }

    if (!edge) {
      const content = document.querySelector<HTMLElement>(CONTENT_FALLBACK_SELECTOR);
      edge = content?.getBoundingClientRect().left ?? 0;
    }

    const left = `${Math.round(edge) + 16}px`;
    for (const el of this.followers) {
      if (el.style.left !== left) el.style.left = left;
    }
  }
}
