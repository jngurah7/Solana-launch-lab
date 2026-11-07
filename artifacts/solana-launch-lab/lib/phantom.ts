import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { decryptPhantomConnectResponse } from './phantom-response';

export { decryptPhantomConnectResponse, hasPhantomResponse } from './phantom-response';

export interface PhantomKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

const PENDING_CONNECT_KEY = 'solana-launch-lab.pending-phantom-connect.v1';
const PENDING_CONNECT_TTL_MS = 15 * 60 * 1000;
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

  // A named callback path produces a valid custom-scheme URI on Android and
  // maps to the app's registered phantom-connect route.
  return Linking.createURL('phantom-connect');
}

async function storePendingKeyPair(keyPair: PhantomKeyPair): Promise<void> {
  const record = JSON.stringify({
    createdAt: Date.now(),
    secretKey: bs58.encode(keyPair.secretKey),
  });

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') {
      throw new Error('Browser storage is unavailable. Please retry the Phantom connection.');
    }
    try {
      // Phantom may return to the app in a new Chrome tab. sessionStorage is
      // tab-scoped, so use same-origin localStorage for this short-lived key.
      window.localStorage.setItem(PENDING_CONNECT_KEY, record);
    } catch {
      throw new Error('Temporary connection storage is unavailable. Please allow site storage and retry.');
    }
    return;
  }

  // This is a short-lived Dapp encryption secret, not a wallet signing key.
  // Android can recreate the JS runtime while Phantom is in the foreground.
  await SecureStore.setItemAsync(PENDING_CONNECT_KEY, record);
}

export async function restorePendingPhantomKeyPair(): Promise<PhantomKeyPair | null> {
  let stored: string | null = null;
  try {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return null;
      stored = window.localStorage.getItem(PENDING_CONNECT_KEY);
    } else {
      stored = await SecureStore.getItemAsync(PENDING_CONNECT_KEY);
    }
  } catch {
    return null;
  }
  if (!stored) return null;

  try {
    const record = JSON.parse(stored) as { createdAt?: number; secretKey?: string };
    if (
      typeof record.createdAt !== 'number' ||
      !Number.isFinite(record.createdAt) ||
      record.createdAt > Date.now() + 60_000 ||
      Date.now() - record.createdAt > PENDING_CONNECT_TTL_MS ||
      typeof record.secretKey !== 'string'
    ) {
      await clearPendingPhantomKeyPair();
      return null;
    }

    const secretKey = bs58.decode(record.secretKey);
    if (secretKey.length !== nacl.box.secretKeyLength) {
      await clearPendingPhantomKeyPair();
      return null;
    }

    return nacl.box.keyPair.fromSecretKey(secretKey);
  } catch {
    await clearPendingPhantomKeyPair();
    return null;
  }
}

export async function clearPendingPhantomKeyPair(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(PENDING_CONNECT_KEY);
    } catch {
      console.warn('Could not clear the temporary Phantom callback key from browser storage.');
    }
    return;
  }

  try {
    await SecureStore.deleteItemAsync(PENDING_CONNECT_KEY);
  } catch {
    console.warn('Could not clear the temporary Phantom callback key from secure storage.');
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

  // Keep only the one-time encryption key long enough to decrypt Phantom's
  // approval after Android resumes or recreates the app process.
  await storePendingKeyPair(keyPair);

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
