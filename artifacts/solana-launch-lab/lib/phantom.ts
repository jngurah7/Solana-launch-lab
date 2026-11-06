import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

export interface PhantomKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

const PENDING_CONNECT_KEY = 'solana-launch-lab.pending-phantom-connect.v1';
const PENDING_CONNECT_TTL_MS = 5 * 60 * 1000;
const PHANTOM_CONNECT_URL = 'https://phantom.com/ul/v1/connect';

function encodeQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function getAppUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error('The app domain is unavailable, so Phantom cannot verify this connection request.');
  }

  return domain.startsWith('http') ? domain : `https://${domain}`;
}

function getRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}${window.location.pathname}`;
  }

  // Returning to the app root avoids sending Expo Router to an unregistered route.
  return Linking.createURL('');
}

function storePendingWebKey(keyPair: PhantomKeyPair): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  window.sessionStorage.setItem(
    PENDING_CONNECT_KEY,
    JSON.stringify({
      createdAt: Date.now(),
      secretKey: bs58.encode(keyPair.secretKey),
    }),
  );
}

export function restorePendingPhantomKeyPair(): PhantomKeyPair | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;

  const stored = window.sessionStorage.getItem(PENDING_CONNECT_KEY);
  if (!stored) return null;

  try {
    const record = JSON.parse(stored) as { createdAt?: number; secretKey?: string };
    if (
      typeof record.createdAt !== 'number' ||
      Date.now() - record.createdAt > PENDING_CONNECT_TTL_MS ||
      typeof record.secretKey !== 'string'
    ) {
      clearPendingPhantomKeyPair();
      return null;
    }

    const secretKey = bs58.decode(record.secretKey);
    if (secretKey.length !== nacl.box.secretKeyLength) {
      clearPendingPhantomKeyPair();
      return null;
    }

    return nacl.box.keyPair.fromSecretKey(secretKey);
  } catch {
    clearPendingPhantomKeyPair();
    return null;
  }
}

export function clearPendingPhantomKeyPair(): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(PENDING_CONNECT_KEY);
    } catch {
      // A restricted browser storage context must not block clearing in-memory state.
    }
  }
}

export async function createPhantomConnectRequest(): Promise<{
  keyPair: PhantomKeyPair;
  url: string;
}> {
  const appUrl = getAppUrl();
  const redirectUrl = getRedirectUrl();
  const secretKey = await Crypto.getRandomBytesAsync(nacl.box.secretKeyLength);
  const keyPair = nacl.box.keyPair.fromSecretKey(secretKey);

  // On the web, sessionStorage allows this short-lived app-to-wallet key to
  // survive Phantom's browser redirect. It is removed after the response.
  storePendingWebKey(keyPair);

  const query = encodeQuery({
    app_url: appUrl,
    cluster: 'devnet',
    dapp_encryption_public_key: bs58.encode(keyPair.publicKey),
    redirect_link: redirectUrl,
  });

  return {
    keyPair,
    url: `${PHANTOM_CONNECT_URL}?${query}`,
  };
}

export function hasPhantomResponse(url: string): boolean {
  try {
    const params = new URL(url).searchParams;
    return params.has('data') || params.has('errorCode');
  } catch {
    return false;
  }
}

export function decryptPhantomConnectResponse(
  url: string,
  keyPair: PhantomKeyPair,
): string {
  const params = new URL(url).searchParams;
  const errorCode = params.get('errorCode');
  if (errorCode) {
    const message = params.get('errorMessage');
    throw new Error(
      message ? `Phantom declined the request: ${message}` : `Phantom declined the request (${errorCode}).`,
    );
  }

  const phantomPublicKey = params.get('phantom_encryption_public_key');
  const encryptedData = params.get('data');
  const nonceValue = params.get('nonce');
  if (!phantomPublicKey || !encryptedData || !nonceValue) {
    throw new Error('Phantom returned an incomplete connection response. Please try again.');
  }

  const phantomKeyBytes = bs58.decode(phantomPublicKey);
  const nonce = bs58.decode(nonceValue);
  if (
    phantomKeyBytes.length !== nacl.box.publicKeyLength ||
    nonce.length !== nacl.box.nonceLength
  ) {
    throw new Error('Phantom returned invalid encryption data. Please start a new connection.');
  }

  const sharedSecret = nacl.box.before(phantomKeyBytes, keyPair.secretKey);
  const cleartext = nacl.box.open.after(
    bs58.decode(encryptedData),
    nonce,
    sharedSecret,
  );
  if (!cleartext) {
    throw new Error('The Phantom response could not be authenticated. Please reconnect.');
  }

  let response: unknown;
  try {
    response = JSON.parse(String.fromCharCode(...cleartext));
  } catch {
    throw new Error('Phantom returned an unreadable connection response. Please reconnect.');
  }

  if (
    typeof response !== 'object' ||
    response === null ||
    !('public_key' in response) ||
    typeof response.public_key !== 'string'
  ) {
    throw new Error('Phantom did not return a wallet address.');
  }

  const publicKeyBytes = bs58.decode(response.public_key);
  if (publicKeyBytes.length !== 32) {
    throw new Error('Phantom returned an invalid Solana wallet address.');
  }

  // The session token is intentionally ignored; this screen never requests signatures.
  return response.public_key;
}
