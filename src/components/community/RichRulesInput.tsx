// RichRulesInput — multiline rules editor with a tiny markdown toolbar.
//
// Zero native deps: it's a plain RN <TextInput> plus two buttons that
// inject markdown-lite markers (`**bold**`, "- " bullet). The stored
// value is the raw markdown string (no schema change) — RichRulesText
// renders it back on the details screen.
//
// Selection handling: we track the live selection via
// onSelectionChange. Bold wraps the current selection (or inserts an
// empty `****` with the cursor between the markers when nothing is
// selected). Bullet prefixes "- " at the start of the line the cursor
// sits on. If selection ever comes back stale we degrade gracefully by
// operating at the end of the text.

import React, { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { InfoTip } from '@/components/InfoTip';

interface Props {
  label?: string;
  info?: { title?: string; text: string };
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}

export function RichRulesInput({
  label,
  info,
  value,
  onChangeText,
  placeholder,
}: Props) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  // Last known selection. Defaults to end-of-text so a button press
  // before the field is ever focused still does something sensible.
  const sel = useRef<{ start: number; end: number }>({
    start: value.length,
    end: value.length,
  });

  const onSelectionChange = (
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    sel.current = e.nativeEvent.selection;
  };

  const applyBold = () => {
    const { start, end } = clampSel(sel.current, value.length);
    const before = value.slice(0, start);
    const middle = value.slice(start, end);
    const after = value.slice(end);
    // Wrap the selection (or insert empty markers at the cursor).
    const next = `${before}**${middle}**${after}`;
    onChangeText(next);
    // Place the cursor inside the markers when nothing was selected so
    // the user can keep typing bold text immediately.
    const caret = start + 2 + middle.length;
    focusAt(caret);
  };

  const applyBullet = () => {
    const { start } = clampSel(sel.current, value.length);
    // Find the start of the line the caret is on.
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const alreadyBullet = /^\s*[-*]\s/.test(value.slice(lineStart));
    if (alreadyBullet) return;
    const next = `${value.slice(0, lineStart)}- ${value.slice(lineStart)}`;
    onChangeText(next);
    focusAt(start + 2);
  };

  const focusAt = (caret: number) => {
    sel.current = { start: caret, end: caret };
    // Re-focus on the next tick so the toolbar tap doesn't steal it.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <View style={styles.wrap}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={[styles.label, styles.labelFlex]}>{label}</Text>
          {info ? <InfoTip title={info.title ?? label} text={info.text} /> : null}
        </View>
      ) : null}

      {/* Toolbar — bold + bullet. Sits above the field. */}
      <View style={styles.toolbar}>
        <ToolbarButton icon="text" label="מודגש" onPress={applyBold} />
        <ToolbarButton icon="list" label="רשימה" onPress={applyBullet} />
      </View>

      <View style={[styles.field, focused && styles.fieldFocused]}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onSelectionChange={onSelectionChange}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          multiline
          textAlignVertical="top"
          style={styles.input}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
    </View>
  );
}

function ToolbarButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.toolBtn, pressed && styles.toolBtnPressed]}
      hitSlop={6}
    >
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={styles.toolBtnText}>{label}</Text>
    </Pressable>
  );
}

function clampSel(
  s: { start: number; end: number },
  len: number,
): { start: number; end: number } {
  // Guard against a stale selection that points past the current text
  // (can happen right after onChangeText before the next selection
  // event lands). Falls back to end-of-text.
  const start = Number.isFinite(s.start) ? Math.max(0, Math.min(s.start, len)) : len;
  const end = Number.isFinite(s.end) ? Math.max(start, Math.min(s.end, len)) : len;
  return { start, end };
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
    alignSelf: 'stretch',
    width: '100%',
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    width: '100%',
  },
  labelFlex: { flexShrink: 1, width: undefined, alignSelf: 'auto' },
  toolbar: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  toolBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
  },
  toolBtnPressed: { opacity: 0.7 },
  toolBtnText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  field: {
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 120,
    borderWidth: 1.5,
    borderColor: '#F5F5F5',
  },
  fieldFocused: {
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
  },
  input: {
    ...typography.body,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
    minHeight: 104,
    paddingVertical: spacing.sm,
  },
});
