import { extension } from '../platform/extension';
import { storage } from '../platform/storage';
import type { Auth } from '../shared/types';
import { redirectUri } from './urls';

const SCOPE = 'api';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export interface AuthHeaderResult {
  headers: Record<string, string>;
  canRefresh: boolean;
}

function base64url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 48): string {
  return base64url(crypto.getRandomValues(new Uint8Array(len)));
}

async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

function toAuth(token: TokenResponse): Auth {
  const lifetime = (token.expires_in ?? 7200) * 1000;
  return {
    kind: 'oauth',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + lifetime,
  };
}

export class AuthService {
  private refreshing: Promise<Auth | null> | null = null;

  async signInWithOAuth(): Promise<void> {
    const settings = await storage.get('settings');
    const clientId = settings.oauthClientId.trim();
    if (!clientId) {
      throw new Error('Paste the Application ID from your GitLab OAuth application first.');
    }

    const verifier = randomString(64);
    const challenge = base64url(await sha256(verifier));
    const state = randomString(16);

    const url = new URL(`${settings.baseUrl}/oauth/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    const responseUrl = await extension.launchWebAuthFlow(url.toString());
    if (!responseUrl) throw new Error('Sign-in was cancelled.');

    const params = new URL(responseUrl).searchParams;
    const oauthError = params.get('error');
    if (oauthError) throw new Error(params.get('error_description') ?? oauthError);
    if (params.get('state') !== state) throw new Error('OAuth state mismatch.');

    const code = params.get('code');
    if (!code) throw new Error('No authorization code returned.');

    const token = await this.tokenRequest(settings.baseUrl, {
      client_id: clientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });

    await storage.set('auth', toAuth(token));
    await storage.set('authError', null);
  }

  async signInWithToken(token: string): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed) throw new Error('Personal access token cannot be empty.');

    await storage.set('auth', { kind: 'pat', token: trimmed });
    await storage.set('authError', null);
  }

  async signOut(): Promise<void> {
    await storage.set('auth', null);
    await storage.set('me', null);
  }

  async getHeaders(forceRefresh = false): Promise<AuthHeaderResult | null> {
    let current = await storage.get('auth');
    if (!current) return null;

    if (current.kind === 'pat') {
      return { headers: { 'PRIVATE-TOKEN': current.token }, canRefresh: false };
    }

    if (forceRefresh || current.expiresAt - Date.now() < 60_000) {
      this.refreshing ??= this.refreshOAuth(current).finally(() => {
        this.refreshing = null;
      });
      current = await this.refreshing;
      if (!current || current.kind !== 'oauth') return null;
    }

    return { headers: { Authorization: `Bearer ${current.accessToken}` }, canRefresh: true };
  }

  private async tokenRequest(baseUrl: string, body: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    if (!res.ok) {
      throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
    }

    return (await res.json()) as TokenResponse;
  }

  private async refreshOAuth(current: Extract<Auth, { kind: 'oauth' }>): Promise<Auth | null> {
    const settings = await storage.get('settings');

    try {
      const token = await this.tokenRequest(settings.baseUrl, {
        client_id: settings.oauthClientId.trim(),
        refresh_token: current.refreshToken,
        grant_type: 'refresh_token',
        redirect_uri: redirectUri(),
      });
      const next = toAuth(token);
      await storage.set('auth', next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await storage.set('authError', `Session expired, sign in again. (${message})`);
      return null;
    }
  }
}

export const auth = new AuthService();
