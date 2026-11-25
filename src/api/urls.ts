import { extension } from '../platform/extension';

export function applicationsUrl(baseUrl: string): string {
  return new URL('/-/user_settings/applications', baseUrl).toString();
}

export function newTokenUrl(baseUrl: string): string {
  const url = new URL('/-/user_settings/personal_access_tokens', baseUrl);
  url.searchParams.set('name', 'PR Tracker');
  url.searchParams.set('scopes', 'api');
  url.searchParams.set('description', 'Used by the PR Tracker Chrome extension');
  return url.toString();
}

export function redirectUri(): string {
  return extension.getRedirectUrl();
}
