import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  clearPendingPhantomKeyPair,
  createPhantomConnectRequest,
  decryptPhantomConnectResponse,
  hasPhantomResponse,
  restorePendingPhantomKeyPair,
  type PhantomKeyPair,
} from '@/lib/phantom';
import { getDevnetBalance } from '@/lib/solana-devnet';
import {
  clearSavedWalletAddress,
  loadSavedWalletAddress,
  saveWalletAddress,
} from '@/lib/wallet-storage';

type BusyAction = 'connect' | 'balance' | 'airdrop' | null;
type NoticeTone = 'info' | 'success' | 'error';

interface Notice {
  tone: NoticeTone;
  text: string;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export default function WalletDevnetScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pendingKeyPair = useRef<PhantomKeyPair | null>(null);
  const handledCallbackUrl = useRef<string | null>(null);
  const callbackSeen = useRef(false);
  const balanceRequestId = useRef(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletVerified, setWalletVerified] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [incomingUrl, setIncomingUrl] = useState<string | null>(null);

  const loadBalance = useCallback(async (address: string) => {
    const requestId = ++balanceRequestId.current;
    setBusy('balance');
    try {
      const nextBalance = await getDevnetBalance(address);
      if (requestId === balanceRequestId.current) {
        setBalance(nextBalance);
        setNotice({ tone: 'success', text: 'Devnet balance refreshed from Solana RPC.' });
      }
    } catch (error) {
      if (requestId === balanceRequestId.current) {
        setNotice({
          tone: 'error',
          text: error instanceof Error ? error.message : 'Could not load the Devnet balance.',
        });
      }
    } finally {
      if (requestId === balanceRequestId.current) setBusy(null);
    }
  }, []);

  const clearPendingKey = useCallback(async () => {
    pendingKeyPair.current?.secretKey.fill(0);
    pendingKeyPair.current = null;
    await clearPendingPhantomKeyPair();
  }, []);

  const queueCallbackUrl = useCallback((url: string | null) => {
    if (!url || !hasPhantomResponse(url)) return;
    callbackSeen.current = true;
    setIncomingUrl(url);
  }, []);

  useEffect(() => {
    let mounted = true;
    const checkInitialUrl = () => {
      void Linking.getInitialURL()
        .then((url) => {
          if (mounted) queueCallbackUrl(url);
        })
        .catch((error: unknown) => {
          console.warn('Could not read the Phantom callback URL.', error);
        });
    };

    const subscription = Linking.addEventListener('url', ({ url }) => queueCallbackUrl(url));
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkInitialUrl();
    });

    checkInitialUrl();

    if (Platform.OS === 'web' && typeof window !== 'undefined' && hasPhantomResponse(window.location.href)) {
      queueCallbackUrl(window.location.href);
    }

    return () => {
      mounted = false;
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [queueCallbackUrl]);

  useEffect(() => {
    let mounted = true;
    const restoreSavedAddress = async () => {
      try {
        const address = await loadSavedWalletAddress();
        if (!address || !mounted || callbackSeen.current) return;

        setWalletAddress(address);
        setWalletVerified(false);
        await loadBalance(address);
        if (mounted && !callbackSeen.current) {
          setNotice({
            tone: 'info',
            text: 'Saved wallet restored for Devnet reads. Reconnect to confirm Phantom approval.',
          });
        }
      } catch (error) {
        if (mounted) {
          setNotice({
            tone: 'error',
            text: error instanceof Error ? error.message : 'Could not restore the saved wallet address.',
          });
        }
      }
    };

    void restoreSavedAddress();
    return () => {
      mounted = false;
    };
  }, [loadBalance]);

  useEffect(() => {
    if (!incomingUrl) return;
    if (handledCallbackUrl.current === incomingUrl) {
      setIncomingUrl(null);
      return;
    }
    handledCallbackUrl.current = incomingUrl;

    const processResponse = async () => {
      try {
        const keyPair = pendingKeyPair.current ?? await restorePendingPhantomKeyPair();
        if (!keyPair) {
          throw new Error(
            'Phantom returned, but the temporary connection key was missing or expired. Start a fresh connection in this browser.',
          );
        }
        pendingKeyPair.current = keyPair;

        const address = decryptPhantomConnectResponse(incomingUrl, keyPair);
        setWalletAddress(address);
        setWalletVerified(true);
        setBalance(null);
        setNotice({ tone: 'success', text: 'Phantom connected. This screen is read-only.' });
        await clearPendingKey();
        await saveWalletAddress(address).catch((error: unknown) => {
          console.warn('Could not save the public wallet address locally.', error);
        });

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.history.replaceState({}, '', window.location.pathname);
        }

        await loadBalance(address);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        await clearPendingKey();
        setWalletVerified(false);
        setNotice({
          tone: 'error',
          text: error instanceof Error ? error.message : 'Could not complete the Phantom connection.',
        });
      } finally {
        setIncomingUrl(null);
      }
    };

    void processResponse();
  }, [incomingUrl, clearPendingKey, loadBalance]);

  const connectWallet = async () => {
    setBusy('connect');
    setWalletVerified(false);
    setNotice(null);
    try {
      await clearPendingKey();
      const request = await createPhantomConnectRequest();
      pendingKeyPair.current = request.keyPair;
      await Haptics.selectionAsync();
      await Linking.openURL(request.url);
      setNotice({
        tone: 'info',
        text: 'Review the connection request in Phantom. Your wallet must approve it.',
      });
    } catch (error) {
      await clearPendingKey();
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not open Phantom.',
      });
    } finally {
      setBusy(null);
    }
  };

  const openDevnetFaucet = async () => {
    if (!walletAddress) return;

    setBusy('airdrop');
    setNotice({ tone: 'info', text: 'Copying your public address and opening Solana’s official faucet…' });
    try {
      await Clipboard.setStringAsync(walletAddress);
      await Linking.openURL('https://faucet.solana.com');
      setNotice({
        tone: 'info',
        text: 'Your address is copied. Choose Devnet on Solana’s official faucet, paste it, request test SOL, then return and refresh. Faucet limits apply.',
      });
      void Haptics.selectionAsync();
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not open Solana’s official faucet.',
      });
    } finally {
      setBusy(null);
    }
  };

  const copyAddress = async () => {
    if (!walletAddress) return;
    try {
      await Clipboard.setStringAsync(walletAddress);
      setNotice({ tone: 'success', text: 'Wallet address copied.' });
      void Haptics.selectionAsync();
    } catch {
      setNotice({ tone: 'error', text: 'Could not copy the wallet address on this device.' });
    }
  };

  const clearWallet = async () => {
    await clearPendingKey();
    await clearSavedWalletAddress().catch((error: unknown) => {
      console.warn('Could not clear the saved public wallet address.', error);
    });
    setWalletAddress(null);
    setWalletVerified(false);
    setBalance(null);
    setNotice({
      tone: 'info',
      text: 'Wallet cleared from this screen. Revoke app access separately in Phantom settings.',
    });
  };

  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;
  const isBusy = busy !== null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar style="light" />
      <View
        pointerEvents="none"
        style={[styles.ambientGlow, { backgroundColor: colors.glow }]}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: topInset + 12, paddingBottom: bottomInset + 30 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.topBar}>
            <View style={styles.brand}>
              <Image
                source={require('../assets/images/icon.png')}
                style={styles.brandIcon}
                accessibilityLabel="Solana Launch Lab icon"
              />
              <View>
                <Text style={[styles.brandOverline, { color: colors.mutedForeground }]}>
                  RESEARCH TERMINAL
                </Text>
                <Text style={[styles.brandName, { color: colors.foreground }]}>
                  Solana <Text style={{ color: colors.primary }}>Launch Lab</Text>
                </Text>
              </View>
            </View>
            <View style={[styles.networkPill, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={[styles.networkDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.networkText, { color: colors.success }]}>DEVNET</Text>
            </View>
          </View>

          <View style={styles.intro}>
            <Text style={[styles.stageLabel, { color: colors.cyan }]}>
              STAGE 01 <Text style={{ color: colors.mutedForeground }}> / WALLET + TESTING</Text>
            </Text>
            <Text style={[styles.headline, { color: colors.foreground }]}>
              Connect safely.{'\n'}
              <Text style={{ color: colors.primary }}>Test on Devnet.</Text>
            </Text>
            <Text style={[styles.introCopy, { color: colors.mutedForeground }]}>
              Connect through Phantom’s approval screen. This app only reads your public address and
              Devnet balance.
            </Text>
          </View>

          <LinearGradient
            colors={[colors.cardRaised, colors.card]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.walletCard, { borderColor: colors.border }]}
          >
            <View style={styles.cardTopLine}>
              <View style={styles.cardLabelRow}>
                <Feather name="shield" size={15} color={colors.primary} />
                <Text style={[styles.cardEyebrow, { color: colors.mutedForeground }]}>
                  WALLET CONNECTION
                </Text>
              </View>
              <Text style={[styles.modeTag, { color: colors.cyan, borderColor: colors.border }]}>
                SOLANA · DEVNET
              </Text>
            </View>

            <View style={styles.balanceBlock}>
              <View style={styles.balanceCaptionRow}>
                <Text style={[styles.cardEyebrow, { color: colors.mutedForeground }]}>
                  DEVNET BALANCE
                </Text>
                {walletAddress ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Refresh Devnet balance"
                    testID="refresh-balance"
                    disabled={isBusy}
                    onPress={() => void loadBalance(walletAddress)}
                    style={({ pressed }) => [styles.refreshButton, { opacity: pressed || isBusy ? 0.55 : 1 }]}
                  >
                    {busy === 'balance' ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Feather name="refresh-cw" size={16} color={colors.primary} />
                    )}
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.balanceValueRow}>
                <Text style={[styles.balanceValue, { color: colors.foreground }]}>
                  {balance === null ? '—' : balance.toFixed(4)}
                </Text>
                <Text style={[styles.balanceUnit, { color: colors.mutedForeground }]}>SOL</Text>
              </View>
              <Text style={[styles.balanceFootnote, { color: colors.mutedForeground }]}>
                {walletAddress
                  ? 'Live balance · Solana Devnet RPC'
                  : 'Connect a wallet to load its real Devnet balance'}
              </Text>
            </View>

            <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />

            {walletAddress ? (
              <View style={styles.connectedWallet}>
                <View style={styles.addressBlock}>
                  <Text style={[styles.cardEyebrow, { color: colors.mutedForeground }]}>
                    {walletVerified ? 'CONNECTED PHANTOM WALLET' : 'SAVED WALLET ADDRESS'}
                  </Text>
                  <Text style={[styles.addressText, { color: colors.foreground }]}>
                    {shortenAddress(walletAddress)}
                  </Text>
                  <Text style={[styles.connectionBody, { color: colors.mutedForeground }]}>
                    {walletVerified
                      ? 'Approved by Phantom · read-only'
                      : 'Reconnect to confirm the Phantom connection'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy wallet address"
                  testID="copy-wallet-address"
                  onPress={() => void copyAddress()}
                  style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Feather name="copy" size={16} color={colors.foreground} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.disconnectedState}>
                <View style={[styles.connectionIcon, { backgroundColor: colors.accent }]}>
                  <Feather name="link-2" size={18} color={colors.primary} />
                </View>
                <View style={styles.connectionCopy}>
                  <Text style={[styles.connectionTitle, { color: colors.foreground }]}>
                    No wallet connected
                  </Text>
                  <Text style={[styles.connectionBody, { color: colors.mutedForeground }]}>
                    Your wallet stays in Phantom. No seed phrase or wallet key is requested.
                  </Text>
                </View>
              </View>
            )}
          </LinearGradient>

          {walletAddress ? (
            <View style={styles.walletActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reconnect Phantom wallet"
                testID="reconnect-phantom"
                disabled={isBusy}
                onPress={() => void connectWallet()}
                style={({ pressed }) => [
                  styles.reconnectButton,
                  { backgroundColor: colors.primary, opacity: pressed || isBusy ? 0.62 : 1 },
                ]}
              >
                {busy === 'connect' ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Feather name="refresh-cw" size={15} color={colors.primaryForeground} />
                )}
                <Text style={[styles.reconnectButtonText, { color: colors.primaryForeground }]}>
                  {walletVerified ? 'Reconnect Phantom' : 'Verify with Phantom'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear the saved wallet address"
                testID="clear-wallet"
                disabled={isBusy}
                onPress={() => void clearWallet()}
                style={({ pressed }) => [
                  styles.clearWalletButton,
                  { borderColor: colors.border, opacity: pressed || isBusy ? 0.55 : 1 },
                ]}
              >
                <Feather name="log-out" size={14} color={colors.mutedForeground} />
                <Text style={[styles.clearWalletText, { color: colors.mutedForeground }]}>
                  Clear
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Connect Phantom wallet"
              testID="connect-phantom"
              disabled={isBusy}
              onPress={() => void connectWallet()}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.primary, opacity: pressed || isBusy ? 0.72 : 1 },
              ]}
            >
              {busy === 'connect' ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Feather name="link" size={18} color={colors.primaryForeground} />
              )}
              <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                {busy === 'connect' ? 'Opening Phantom…' : 'Connect Phantom wallet'}
              </Text>
              {busy !== 'connect' ? (
                <Feather name="arrow-up-right" size={17} color={colors.primaryForeground} />
              ) : null}
            </Pressable>
          )}

          <View style={[styles.safetyRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Feather name="lock" size={15} color={colors.success} />
            <Text style={[styles.safetyText, { color: colors.secondaryForeground }]}>
              Wallet approval required <Text style={{ color: colors.mutedForeground }}>· no signatures requested</Text>
            </Text>
          </View>

          <View style={[styles.faucetCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.faucetHeader}>
              <View style={[styles.faucetIcon, { backgroundColor: colors.accent }]}>
                <Feather name="droplet" size={17} color={colors.primary} />
              </View>
              <View style={styles.faucetHeading}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Devnet faucet</Text>
                <Text style={[styles.sectionCaption, { color: colors.mutedForeground }]}>
                  Test funds only · no real-world value
                </Text>
              </View>
              <View style={[styles.testOnlyPill, { borderColor: colors.border }]}>
                <Text style={[styles.testOnlyText, { color: colors.cyan }]}>TEST ONLY</Text>
              </View>
            </View>
            <Text style={[styles.faucetCopy, { color: colors.mutedForeground }]}>
              The public RPC no longer accepts airdrops. Copy your address and request test funds from Solana’s official faucet.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Request one Devnet SOL"
              testID="request-devnet-sol"
              disabled={!walletAddress || isBusy}
              onPress={() => void openDevnetFaucet()}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: !walletAddress || isBusy ? 0.42 : pressed ? 0.65 : 1,
                },
              ]}
            >
              {busy === 'airdrop' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="plus-circle" size={17} color={colors.primary} />
              )}
              <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                {busy === 'airdrop'
                  ? 'Opening official faucet…'
                  : walletAddress
                    ? 'Open official Solana faucet'
                    : 'Connect a wallet to continue'}
              </Text>
              {busy !== 'airdrop' && walletAddress ? (
                <Feather name="arrow-up-right" size={15} color={colors.mutedForeground} />
              ) : null}
            </Pressable>
          </View>

          {notice ? (
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.notice,
                {
                  backgroundColor:
                    notice.tone === 'error'
                      ? colors.dangerSurface
                      : notice.tone === 'success'
                        ? colors.accent
                        : colors.surface,
                  borderColor:
                    notice.tone === 'error'
                      ? colors.destructive
                      : notice.tone === 'success'
                        ? colors.success
                        : colors.border,
                },
              ]}
            >
              <Feather
                name={notice.tone === 'error' ? 'alert-triangle' : notice.tone === 'success' ? 'check-circle' : 'info'}
                size={16}
                color={notice.tone === 'error' ? colors.destructive : notice.tone === 'success' ? colors.success : colors.cyan}
              />
              <Text style={[styles.noticeText, { color: colors.foreground }]}>{notice.text}</Text>
            </View>
          ) : null}

          <View style={[styles.safetyPanel, { borderColor: colors.border }]}>
            <View style={styles.safetyPanelHeader}>
              <Text style={[styles.cardEyebrow, { color: colors.mutedForeground }]}>SAFETY STATUS</Text>
              <View style={[styles.liveOffPill, { borderColor: colors.border }]}>
                <View style={[styles.networkDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.liveOffText, { color: colors.success }]}>LIVE TRADING OFF</Text>
              </View>
            </View>
            <View style={styles.statusLine}>
              <Feather name="check" size={15} color={colors.success} />
              <Text style={[styles.statusText, { color: colors.secondaryForeground }]}>Devnet selected and fixed</Text>
            </View>
            <View style={styles.statusLine}>
              <Feather name="minus" size={15} color={colors.mutedForeground} />
              <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                Market prices and token feeds are not connected
              </Text>
            </View>
            <View style={styles.statusLine}>
              <Feather name="clock" size={15} color={colors.mutedForeground} />
              <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                Token risk scans and paper trading are not active yet
              </Text>
            </View>
            <Text
              style={[
                styles.upcomingText,
                { color: colors.mutedForeground, borderTopColor: colors.border },
              ]}
            >
              Next phase: token discovery, then paper trading with an A$100 test budget and loss limits.
            </Text>
          </View>

          <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
            Solana Launch Lab never asks for recovery phrases or wallet private keys. No live transaction is created or sent from this screen.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    overflow: 'hidden',
  },
  ambientGlow: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    top: -190,
    right: -150,
  },
  scrollContent: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  content: {
    width: '100%',
    maxWidth: 520,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 34,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  brandIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
  },
  brandOverline: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.4,
    marginBottom: 3,
  },
  brandName: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.3,
  },
  networkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  networkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  networkText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
  },
  intro: {
    marginBottom: 23,
  },
  stageLabel: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.25,
    marginBottom: 12,
  },
  headline: {
    fontSize: 34,
    lineHeight: 39,
    letterSpacing: -1.2,
    fontFamily: 'Inter_700Bold',
    marginBottom: 13,
  },
  introCopy: {
    maxWidth: 410,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'Inter_400Regular',
  },
  walletCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 19,
    overflow: 'hidden',
    marginBottom: 9,
  },
  cardTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardEyebrow: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.1,
  },
  modeTag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  balanceBlock: {
    marginTop: 25,
    marginBottom: 20,
  },
  balanceCaptionRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refreshButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 9,
    marginTop: 1,
  },
  balanceValue: {
    fontSize: 43,
    lineHeight: 52,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: -1.8,
    fontVariant: ['tabular-nums'],
  },
  balanceUnit: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  balanceFootnote: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  cardDivider: {
    height: 1,
    opacity: 0.8,
  },
  connectedWallet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 17,
    gap: 12,
  },
  addressBlock: {
    flex: 1,
    gap: 6,
  },
  addressText: {
    fontSize: 14,
    letterSpacing: 0.5,
    fontFamily: 'Inter_600SemiBold',
  },
  iconButton: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectedState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 16,
  },
  connectionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionCopy: {
    flex: 1,
    gap: 4,
  },
  connectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  connectionBody: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'Inter_400Regular',
  },
  primaryButton: {
    width: '100%',
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
  },
  primaryButtonText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  walletActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reconnectButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  reconnectButtonText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  clearWalletButton: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  clearWalletText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  safetyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    marginBottom: 24,
  },
  safetyText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    fontFamily: 'Inter_500Medium',
  },
  faucetCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 17,
    marginBottom: 14,
  },
  faucetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  faucetIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faucetHeading: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 3,
  },
  sectionCaption: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
  },
  testOnlyPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  testOnlyText: {
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.7,
  },
  faucetCopy: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: 'Inter_400Regular',
    marginTop: 14,
    marginBottom: 15,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  secondaryButtonText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    marginBottom: 14,
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
    fontFamily: 'Inter_500Medium',
  },
  safetyPanel: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginTop: 2,
  },
  safetyPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  liveOffPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  liveOffText: {
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.65,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
  },
  statusText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'Inter_500Medium',
  },
  upcomingText: {
    borderTopWidth: 1,
    marginTop: 3,
    paddingTop: 12,
    fontSize: 10,
    lineHeight: 16,
    fontFamily: 'Inter_400Regular',
  },
  footerNote: {
    textAlign: 'center',
    fontSize: 9,
    lineHeight: 15,
    fontFamily: 'Inter_400Regular',
    marginTop: 19,
    paddingHorizontal: 10,
  },
});
