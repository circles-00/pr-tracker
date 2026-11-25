import { extension } from '../../platform/extension';
import { bus } from '../../platform/messaging';
import { severityToTone, timeAgo } from '../../shared/format';
import type { FeedItem } from '../../shared/types';
import { h } from '../shared/dom';

export function feedSection(feed: FeedItem[]): HTMLElement | null {
  const unread = feed.filter((item) => !item.read);
  if (!unread.length) return null;

  const markRead = (ids?: string[]) => void bus.send('readFeed', { ids });

  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'row' },
      h('strong', { class: 'grow' }, `Notifications (${unread.length})`),
      h('button', { type: 'button', class: 'ghost small', onclick: () => markRead() }, 'Dismiss all'),
    ),
    unread.slice(0, 8).map((item) => {
      const tone = severityToTone(item.severity);
      const toneClass = tone ? `tone-${tone}` : 'tone-info';

      return h(
        'div',
        { class: `card ${toneClass}` },
        h(
          'div',
          { class: 'row' },
          h('strong', { class: 'grow' }, item.title),
          h('span', { class: 'small muted' }, timeAgo(item.at)),
          h('button', { type: 'button', class: 'ghost small', title: 'Dismiss', onclick: () => markRead([item.id]) }, '✕'),
        ),
        h('div', { class: 'small muted pre-line' }, item.message),
        h(
          'div',
          { class: 'row mt-sm' },
          item.promoteKey &&
            h(
              'button',
              {
                type: 'button',
                class: 'primary small',
                onclick: async () => {
                  await bus.send('promote', { key: item.promoteKey! });
                  await bus.send('readFeed', { ids: [item.id] });
                },
              },
              'Promote now',
            ),
          h(
            'button',
            {
              type: 'button',
              class: 'small',
              onclick: async () => {
                await extension.openTab(item.url);
                await bus.send('readFeed', { ids: [item.id] });
              },
            },
            'Open',
          ),
        ),
      );
    }),
  );
}
