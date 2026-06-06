// FeedbackScreen — in-app "report a problem / suggest a feature" form.
//
// Reached from the profile hamburger menu (Support section). Writes a
// single doc to the `feedback` collection via feedbackService; the admin
// panel reads those. A segmented toggle picks bug vs suggestion; a
// multiline field holds the user's text (≤2000 chars, matching the rule).

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { toast } from '@/components/Toast';
import { submitFeedback, type FeedbackType } from '@/services/feedbackService';
import { he } from '@/i18n/he';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

const MAX_LEN = 2000;

export function FeedbackScreen() {
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const route = useRoute();
  // When opened from a dedicated menu entry ("דיווח על תקלה" / "הצעת שיפור"),
  // the type is preset and the toggle is hidden — a focused single-type form.
  const presetType = (route.params as { type?: FeedbackType } | undefined)?.type;
  const dedicated = !!presetType;
  const [type, setType] = useState<FeedbackType>(presetType ?? 'bug');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const trimmed = message.trim();
  const canSubmit = trimmed.length > 0 && !sending;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSending(true);
    try {
      await submitFeedback(type, trimmed, route.name);
      toast.success(he.feedbackSuccess);
      nav.goBack();
    } catch {
      toast.error(he.feedbackError);
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader
        title={
          dedicated
            ? type === 'bug'
              ? he.feedbackTypeBug
              : he.feedbackTypeSuggestion
            : he.feedbackTitle
        }
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          {/* Segmented toggle — only when no preset type (generic entry). */}
          {!dedicated ? (
            <View style={styles.segment}>
              <SegmentButton
                label={he.feedbackTypeBug}
                active={type === 'bug'}
                onPress={() => setType('bug')}
              />
              <SegmentButton
                label={he.feedbackTypeSuggestion}
                active={type === 'suggestion'}
                onPress={() => setType('suggestion')}
              />
            </View>
          ) : null}

          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={he.feedbackPlaceholder}
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={MAX_LEN}
            textAlignVertical="top"
            style={styles.input}
          />
          <Text style={styles.counter}>
            {`‎${message.length} / ${MAX_LEN}`}
          </Text>
        </View>

        <View style={styles.footer}>
          <Button
            title={he.feedbackSubmit}
            onPress={onSubmit}
            disabled={!canSubmit}
            loading={sending}
            fullWidth
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
    >
      <Text
        style={[styles.segmentText, active && styles.segmentTextActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: colors.surface,
    // Lift the active pill above the track.
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentText: {
    ...typography.button,
    color: colors.textMuted,
  },
  segmentTextActive: {
    color: colors.primary,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: '#F5F5F5',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 180,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  counter: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
});
