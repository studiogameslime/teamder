// RuleTagsInput — free-text rule chips. Replaces the old fixed
// hasReferee/hasPenalties/hasHalfTime toggles in the Game wizard.
//
// Behaviour:
//   • Type → add tag on Enter, comma, or "+" button.
//   • Tap × on a chip → remove.
//   • Hard caps: maxTags chips, ≤30 chars each (matches firestore.rules).
//
// Visual:
//   ┌──────────────────────────────────────────────────┐
//   │ [שופט ×]  [משחקים עם חוצים ×]                    │
//   │ ┌──────────────────────────────────────┐ ┌────┐  │
//   │ │ הוסף חוק נוסף…                       │ │ +  │  │
//   │ └──────────────────────────────────────┘ └────┘  │
//   └──────────────────────────────────────────────────┘

import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { InfoTip } from './InfoTip';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Show above the chip area. Optional; the wizard provides one. */
  label?: string;
  /** Optional ⓘ next to the label with a brief explanation. */
  info?: { title?: string; text: string };
  /** Placeholder shown inside the empty input. */
  placeholder?: string;
  maxTags?: number;
  maxTagLength?: number;
}

const DEFAULT_MAX_TAGS = 12;
const DEFAULT_MAX_LEN = 30;

export function RuleTagsInput({
  value,
  onChange,
  label,
  info,
  placeholder,
  maxTags = DEFAULT_MAX_TAGS,
  maxTagLength = DEFAULT_MAX_LEN,
}: Props) {
  const [draft, setDraft] = useState('');

  const tryAdd = (raw: string) => {
    const cleaned = raw.trim().slice(0, maxTagLength);
    if (cleaned.length === 0) return;
    if (value.length >= maxTags) return;
    if (value.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
      // Don't add duplicates; just clear the input so the user sees
      // their typing accepted as "no-op".
      setDraft('');
      return;
    }
    onChange([...value, cleaned]);
    setDraft('');
  };

  const handleChange = (t: string) => {
    // Allow comma-as-delimiter for users who type fast: typing
    // "שופט, חוצים" auto-adds the first as a chip mid-stream.
    if (t.includes(',')) {
      const parts = t.split(',');
      const last = parts.pop() ?? '';
      parts.forEach((p) => tryAdd(p));
      setDraft(last.slice(0, maxTagLength));
      return;
    }
    setDraft(t.slice(0, maxTagLength));
  };

  const remove = (idx: number) =>
    onChange(value.filter((_, i) => i !== idx));

  const atCap = value.length >= maxTags;
  return (
    <View style={styles.wrap}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={[styles.label, styles.labelFlex]}>{label}</Text>
          {info ? <InfoTip title={info.title ?? label} text={info.text} size={16} /> : null}
        </View>
      ) : null}

      {value.length > 0 ? (
        <View style={styles.chipsRow}>
          {value.map((tag, idx) => (
            <View key={`${tag}-${idx}`} style={styles.chip}>
              <Text style={styles.chipText}>{tag}</Text>
              <Pressable
                onPress={() => remove(idx)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={he.ruleTagsRemove(tag)}
              >
                <Ionicons name="close" size={14} color="#1D4ED8" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {!atCap ? (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={handleChange}
            onSubmitEditing={() => tryAdd(draft)}
            placeholder={placeholder ?? he.ruleTagsPlaceholder}
            placeholderTextColor="#94A3B8"
            returnKeyType="done"
            maxLength={maxTagLength}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={() => tryAdd(draft)}
            disabled={draft.trim().length === 0}
            style={({ pressed }) => [
              styles.addBtn,
              draft.trim().length === 0 && { opacity: 0.4 },
              pressed && draft.trim().length > 0 && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={he.ruleTagsAdd}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : (
        <Text style={styles.cap}>{he.ruleTagsAtCap(maxTags)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  labelFlex: { flex: 1 },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#DBEAFE',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  chipText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1D4ED8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cap: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});
