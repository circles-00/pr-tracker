function isEditingInside(root: ParentNode): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement)) {
    return false;
  }

  return root === document || root.contains(active);
}

export function createDeferredRenderer(root: ParentNode, render: () => Promise<void>): () => void {
  let pending = false;

  return (): void => {
    if (!isEditingInside(root)) {
      void render();
      return;
    }

    if (pending) return;

    pending = true;
    const active = document.activeElement as HTMLElement;
    active.addEventListener(
      'blur',
      () => {
        pending = false;
        void render();
      },
      { once: true },
    );
  };
}
