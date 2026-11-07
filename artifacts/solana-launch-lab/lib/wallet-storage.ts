import AsyncStorage from '@react-native-async-storage/async-storage';
import bs58 from 'bs58';

const WALLET_ADDRESS_KEY = 'solana-launch-lab.approved-wallet-address.v1';

function isValidSolanaAddress(address: string): boolean {
  try {
    return bs58.decode(address).length === 32;
  } catch {
    return false;
  }
}

export async function loadSavedWalletAddress(): Promise<string | null> {
  const address = await AsyncStorage.getItem(WALLET_ADDRESS_KEY);
  if (!address) return null;
  if (isValidSolanaAddress(address)) return address;

  await AsyncStorage.removeItem(WALLET_ADDRESS_KEY);
  return null;
}

export async function saveWalletAddress(address: string): Promise<void> {
  if (!isValidSolanaAddress(address)) {
    throw new Error('Phantom returned an invalid Solana wallet address.');
  }
  await AsyncStorage.setItem(WALLET_ADDRESS_KEY, address);
}

export async function clearSavedWalletAddress(): Promise<void> {
  await AsyncStorage.removeItem(WALLET_ADDRESS_KEY);
}
