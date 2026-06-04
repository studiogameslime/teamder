// RemoteGates — UI surfaces driven entirely by Remote Config, so they can be
// turned on/off and re-worded live from the Firebase console with no release.
//
//   • MaintenanceGate    — full-screen blocking overlay (maintenance_mode).
//   • AnnouncementBanner — dismissible top banner (announcement_*).
//
// Both re-render when Remote Config activates (useRemoteConfig) and render
// nothing when their flag is off.

import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '@/theme';
import { rcBool, rcString, useRemoteConfig } from '@/services/remoteConfigService';

const DEFAULT_MAINTENANCE_MSG =
  'אנחנו עורכים תחזוקה קצרה ונחזור עוד מעט. תודה על הסבלנות 🙏';

/** Blocking full-screen overlay shown while `maintenance_mode` is on. */
export function MaintenanceGate(): React.ReactElement | null {
  useRemoteConfig();
  if (!rcBool('maintenance_mode')) return null;
  const msg = rcString('maintenance_message').trim() || DEFAULT_MAINTENANCE_MSG;
  return (
    <View style={styles.gate} pointerEvents="auto">
      <Ionicons name="construct-outline" size={64} color={colors.primary} />
      <Text style={styles.gateTitle}>בתחזוקה</Text>
      <Text style={styles.gateMsg}>{msg}</Text>
    </View>
  );
}

/** Dismissible top banner shown while `announcement_enabled` is on. */
export function AnnouncementBanner(): React.ReactElement | null {
  useRemoteConfig();
  const [dismissed, setDismissed] = useState(false);
  const text = rcString('announcement_text').trim();
  if (dismissed || !rcBool('announcement_enabled') || !text) return null;
  const url = rcString('announcement_url').trim();
  const open = url
    ? () => {
        Linking.openURL(url).catch(() => undefined);
      }
    : undefined;
  return (
    <SafeAreaView edges={['top']} style={styles.annSafe}>
      <Pressable
        onPress={open}
        style={styles.annBar}
        accessibilityRole={url ? 'link' : 'text'}
      >
        <Ionicons
          name="megaphone-outline"
          size={18}
          color={colors.textOnPrimary}
        />
        <Text style={styles.annText} numberOfLines={2}>
          {text}
        </Text>
        <Pressable onPress={() => setDismissed(true)} hitSlop={10}>
          <Ionicons name="close" size={18} color={colors.textOnPrimary} />
        </Pressable>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  gate: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
    zIndex: 9999,
  },
  gateTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.sm,
  },
  gateMsg: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textMuted,
    textAlign: 'center',
  },
  annSafe: { backgroundColor: colors.primary },
  annBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  annText: {
    flex: 1,
    color: colors.textOnPrimary,
    fontSize: 13.5,
    fontWeight: '600',
    textAlign: 'right',
  },
});
