// CoverImagePicker — full-screen modal to choose a community cover:
// either a built-in image from our curated gallery, or upload one from
// the device. Mirrors the player-avatar picker pattern.

import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COVER_IMAGES } from '@/data/coverImages';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  visible: boolean;
  /** Currently-selected built-in cover id (highlights it in the grid). */
  selectedId?: string;
  /** True when the group currently uses an uploaded photo (so no built-in
   *  is highlighted). */
  hasUploadedPhoto?: boolean;
  /** Spinner while a device upload is in flight. */
  uploading?: boolean;
  onSelectBuiltin: (id: string) => void;
  onUploadFromDevice: () => void;
  onClose: () => void;
}

export function CoverImagePicker({
  visible,
  selectedId,
  hasUploadedPhoto,
  uploading,
  onSelectBuiltin,
  onUploadFromDevice,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{he.coverPickerTitle}</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          {/* Upload from device */}
          <Pressable
            style={({ pressed }) => [styles.uploadBtn, pressed && { opacity: 0.9 }]}
            onPress={onUploadFromDevice}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                <Text style={styles.uploadBtnText}>{he.coverPickerUpload}</Text>
              </>
            )}
          </Pressable>

          <Text style={styles.sectionLabel}>{he.coverPickerGalleryLabel}</Text>

          {/* Built-in gallery grid */}
          <View style={styles.grid}>
            {COVER_IMAGES.map((c) => {
              const active = !hasUploadedPhoto && selectedId === c.id;
              return (
                <Pressable
                  key={c.id}
                  style={({ pressed }) => [
                    styles.cell,
                    active && styles.cellActive,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => onSelectBuiltin(c.id)}
                >
                  <Image source={c.source} style={styles.thumb} resizeMode="cover" />
                  {active ? (
                    <View style={styles.checkBadge}>
                      <Ionicons name="checkmark" size={16} color="#fff" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  closeBtn: { padding: 2 },
  headerTitle: { ...typography.h3, color: colors.text, fontWeight: '800' },
  body: { padding: spacing.lg, gap: spacing.md },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
  uploadBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    width: '100%',
    marginTop: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  cell: {
    width: '48%',
    aspectRatio: 16 / 10,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: colors.surfaceMuted,
  },
  cellActive: { borderColor: colors.primary },
  thumb: { width: '100%', height: '100%' },
  checkBadge: {
    position: 'absolute',
    top: 6,
    insetInlineEnd: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
