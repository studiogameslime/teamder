import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { openStore } from '@/services/updateService';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  type: 'force' | 'optional';
  onClose?: () => void;
}

export function UpdateModal({ type, onClose }: Props) {
  const isForce = type === 'force';
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={isForce ? () => {} : onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={isForce ? undefined : onClose}
      >
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.iconWrap}>
            <Ionicons
              name="cloud-download-outline"
              size={28}
              color={colors.primary}
            />
          </View>
          <Text style={styles.title}>
            {isForce ? he.updateForceTitle : he.updateOptionalTitle}
          </Text>
          <Text style={styles.body}>
            {isForce ? he.updateForceBody : he.updateOptionalBody}
          </Text>
          <View style={styles.actions}>
            {!isForce && onClose ? (
              <View style={{ flex: 1 }}>
                <Button
                  title={he.updateLater}
                  variant="outline"
                  size="lg"
                  fullWidth
                  onPress={onClose}
                />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Button
                title={he.updateNow}
                variant="primary"
                size="lg"
                fullWidth
                onPress={openStore}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 22,
    marginBottom: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
