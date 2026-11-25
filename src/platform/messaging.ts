import {
  CONTENT_ALLOWED_MESSAGES,
  type MessageMap,
  type MessageType,
  type ResponseEnvelope,
} from '../shared/messages';

type MessageConstraint<M> = { [K in keyof M]: { req: unknown; res: unknown } };

export type MessageHandlersFor<M extends MessageConstraint<M>> = {
  [K in keyof M & string]: (
    payload: M[K]['req'],
    sender: chrome.runtime.MessageSender,
  ) => Promise<M[K]['res']> | M[K]['res'];
};

export type MessageHandlers = MessageHandlersFor<MessageMap>;

export class MessageBus<M extends MessageConstraint<M>> {
  constructor(private readonly contentAllowed: ReadonlySet<keyof M & string>) {}

  send<K extends keyof M & string>(
    type: K,
    ...args: keyof M[K]['req'] extends never ? [] : [payload: M[K]['req']]
  ): Promise<M[K]['res']> {
    const payload = (args[0] ?? {}) as Record<string, unknown>;
    const message = { type, ...payload };

    return chrome.runtime.sendMessage(message).then((res: ResponseEnvelope<M[K]['res']> | undefined) => {
      if (!res?.ok) throw new Error(res?.error ?? 'Extension error');
      return res.data;
    });
  }

  register(handlers: MessageHandlersFor<M>): void {
    chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
      if (!raw || typeof raw !== 'object' || !('type' in raw)) {
        sendResponse({ ok: false, error: 'Invalid message' } satisfies ResponseEnvelope<never>);
        return false;
      }

      const type = String((raw as { type: unknown }).type) as keyof M & string;
      const handler = handlers[type] as
        | ((payload: unknown, sender: chrome.runtime.MessageSender) => Promise<unknown> | unknown)
        | undefined;

      if (!handler) {
        sendResponse({ ok: false, error: `Unknown message type: ${type}` } satisfies ResponseEnvelope<never>);
        return false;
      }

      if (!this.isAllowedSender(type, sender)) {
        sendResponse({ ok: false, error: `Unauthorized message: ${type}` } satisfies ResponseEnvelope<never>);
        return false;
      }

      Promise.resolve()
        .then(() => handler(raw, sender))
        .then(
          (data) => sendResponse({ ok: true, data } satisfies ResponseEnvelope<unknown>),
          (err: unknown) => {
            const error = err instanceof Error ? err.message : String(err);
            sendResponse({ ok: false, error } satisfies ResponseEnvelope<never>);
          },
        );

      return true;
    });
  }

  private isAllowedSender(type: keyof M & string, sender: chrome.runtime.MessageSender): boolean {
    if (sender.id && sender.id !== chrome.runtime.id) return false;

    const isExtensionPage = !sender.tab || Boolean(sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`));
    if (isExtensionPage) return true;

    return this.contentAllowed.has(type);
  }
}

export const bus = new MessageBus<MessageMap>(CONTENT_ALLOWED_MESSAGES as ReadonlySet<MessageType>);
