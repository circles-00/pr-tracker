import { extension } from '../platform/extension';
import { storage } from '../platform/storage';
import { SELF_HOSTED_SCRIPT_ID } from '../shared/constants';

export async function syncSelfHostedContentScript(): Promise<void> {
  const { baseUrl } = await storage.get('settings');

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return;
  }

  const targetOrigin = origin === 'https://gitlab.com' ? null : origin;
  await extension.syncContentScript(SELF_HOSTED_SCRIPT_ID, targetOrigin, ['content.js']);
}
