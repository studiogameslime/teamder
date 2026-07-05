// ManageEquipmentSheet — a small bottom sheet an admin uses to mark which of
// the club's shared equipment (ball / jerseys) is currently held by a given
// player. Both are INDEPENDENT toggles (a club can have several people each
// holding a ball / a set of jerseys), so this only flips THIS player's flag —
// it never moves the mark off anyone else.
//
// Mirrors IssueCardSheet's structure (SpringSheet + shared Button) so the
// community sheets share one animation + button language.

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export interface EquipmentFlags {
  ball: boolean;
  jerseys: boolean;
}

export function ManageEquipmentSheet({
  visible,
  playerName,
  initial,
  saving,
  onSave,
  onClose,
}: {
  visible: boolean;
  playerName: string;
  /** Current holder flags for this player (from the group's holder arrays). */
  initial: EquipmentFlags;
  saving: boolean;
  onSave: (flags: EquipmentFlags) => void;
  onClose: () => void;
}) {
  const [ball, setBall] = useState(initial.ball);
  const [jerseys, setJerseys] = useState(initial.jerseys);

  // Re-seed the toggles from the live holder state every time the sheet opens
  // for a (possibly different) player.
  useEffect(() => {
    if (visible) {
      setBall(initial.ball);
      setJerseys(initial.jerseys);
    }
  }, [visible, initial.ball, initial.jerseys]);

  const dirty = ball !== initial.ball || jerseys !== initial.jerseys;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <SpringSheet visible={visible} onBackdropPress={saving ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grip} />
          <View style={styles.titleRow}>
            <View style={styles.chip}>
              <Ionicons name="cube-outline" size={16} color="#FFF" />
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {he.manageEquipmentTitle(playerName)}
            </Text>
          </View>
          <Text style={styles.subtitle}>{he.manageEquipmentSubtitle}</Text>

          <ToggleRow
            icon="football"
            iconColor="#1D4ED8"
            label={he.equipmentBall}
            value={ball}
            onValueChange={setBall}
            disabled={saving}
          />
          <ToggleRow
            icon="shirt"
            iconColor="#7C3AED"
            label={he.equipmentJerseys}
            value={jerseys}
            onValueChange={setJerseys}
            disabled={saving}
          />

          <View style={styles.actions}>
            <Button
              title={he.save}
              variant="primary"
              size="lg"
              style={styles.actionBtn}
              loading={saving}
              disabled={!dirty}
              onPress={() => onSave({ ball, jerseys })}
            />
            <Button
              title={he.cancel}
              variant="outline"
              size="lg"
              style={styles.actionBtn}
              disabled={saving}
              onPress={onClose}
            />
          </View>
        </Pressable>
      </SpringSheet>
    </Modal>
  );
}

function ToggleRow({
  icon,
  iconColor,
  label,
  value,
  onValueChange,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={styles.toggleRow}
      onPress={() => !disabled && onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
    >
      <View style={[styles.toggleIcon, { backgroundColor: iconColor + '18' }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor="#FFFFFF"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  grip: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm },
  chip: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  title: { flex: 1, ...typography.h3, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  subtitle: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginBottom: spacing.xs },
  toggleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
  },
  toggleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleLabel: { flex: 1, ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  actions: { flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1 },
});
