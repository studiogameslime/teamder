// AutocompleteInput — TextInput + dropdown of suggestions fetched
// asynchronously, with debounce and a manual-typing fallback if the source
// returns nothing.
//
// Designed to be source-agnostic: pass `fetchSuggestions(q)` and the input
// handles debounce, loading state, and dropdown rendering. The consumer
// owns `value` (controlled input) and is responsible for clearing the
// dependent fields when this one's selected value changes.
//
// RTL: TextInput is right-aligned, dropdown anchors below the input, items
// are rendered with `textAlign: 'right'`.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Called when the user taps a suggestion. Receives the suggestion. */
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Async source. Returning [] means "no suggestions; let the user type". */
  fetchSuggestions: (query: string) => Promise<string[]>;
  /** Minimum chars before triggering fetch. Default 2. */
  minChars?: number;
  /** Debounce delay in ms. Default 300. */
  debounceMs?: number;
  style?: ViewStyle;
}

export function AutocompleteInput({
  label,
  value,
  onChange,
  onSelect,
  placeholder,
  disabled,
  fetchSuggestions,
  minChars = 2,
  debounceMs = 300,
  style,
}: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // Tracks which value the user just selected so we don't immediately
  // re-open the dropdown for the same string they tapped.
  const lastSelected = useRef<string | null>(null);

  useEffect(() => {
    if (disabled) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    if (!open) return;
    if (lastSelected.current === value) return;

    const q = value.trim();
    if (q.length < minChars) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const results = await fetchSuggestions(q);
        if (alive) setSuggestions(results);
      } catch {
        if (alive) setSuggestions([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, debounceMs);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [value, open, disabled, fetchSuggestions, minChars, debounceMs]);

  const handleSelect = (s: string) => {
    lastSelected.current = s;
    onSelect(s);
    setOpen(false);
    setSuggestions([]);
  };

  const handleChange = (v: string) => {
    if (lastSelected.current && v !== lastSelected.current) {
      lastSelected.current = null;
    }
    onChange(v);
    if (!open) setOpen(true);
  };

  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          value={value}
          onChangeText={handleChange}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          // Match InputField — lighter than textMuted so the hint
          // doesn't look like a real value.
          placeholderTextColor="#9CA3AF"
          editable={!disabled}
          style={[styles.input, disabled && styles.inputDisabled]}
          textAlign="right"
        />
        {loading ? (
          <ActivityIndicator
            style={styles.loader}
            size="small"
            color={colors.primary}
          />
        ) : null}
      </View>
      {open && !disabled && suggestions.length > 0 ? (
        <View style={styles.dropdown}>
          {suggestions.slice(0, 8).map((s) => (
            <Pressable
              key={s}
              onPress={() => handleSelect(s)}
              style={({ pressed }) => [
                styles.option,
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Text style={styles.optionText} numberOfLines={1}>
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textMuted },
  inputWrap: { position: 'relative' },
  // Matches InputField visually so an autocomplete cell sits in the
  // same form rhythm as the regular text inputs around it (light-gray
  // pill, no border, identical padding + radius).
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    // TextInput value uses physical 'right' (Android TextInput
    // respects physical alignment, unlike <Text> labels). Without
    // this, short Hebrew values cling to the visual LEFT of the
    // pill on Android.
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  inputDisabled: {
    color: colors.textMuted,
  },
  loader: {
    position: 'absolute',
    left: spacing.md,
    top: 0,
    bottom: 0,
  },
  dropdown: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  option: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  optionText: {
    ...typography.body,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
});
