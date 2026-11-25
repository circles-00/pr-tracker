export function initSectionNav(): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.nav-item[data-target]')];
  const sections = buttons
    .map((btn) => document.getElementById(btn.dataset.target!))
    .filter((el): el is HTMLElement => Boolean(el));

  let activeId = sections[0]?.id ?? '';
  let lockUntil = 0;

  const setActive = (id: string): void => {
    if (id === activeId) return;
    activeId = id;

    for (const btn of buttons) {
      btn.classList.toggle('active', btn.dataset.target === id);
    }
  };

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.target;
      if (!id) return;

      const target = document.getElementById(id);
      if (!target) return;

      setActive(id);
      lockUntil = Date.now() + 500;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const syncFromScroll = (): void => {
    if (Date.now() < lockUntil || sections.length === 0) return;

    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;
    if (atBottom) {
      setActive(sections[sections.length - 1].id);
      return;
    }

    let current = sections[0].id;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= 120) {
        current = section.id;
      }
    }

    setActive(current);
  };

  window.addEventListener('scroll', syncFromScroll, { passive: true });
}
