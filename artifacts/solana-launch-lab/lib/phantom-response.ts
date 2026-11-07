import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type { PhantomKeyPair } from './phantom';

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

  // The read-only app deliberately discards Phantom's signing session token.
  return response.public_key;
}
