// RichRulesText — pure-JS, zero-dependency markdown-lite renderer for
// community rules (חוקי המועדון).
//
// Supported syntax (intentionally tiny, no native deps):
//   • **bold**            → bold inline span
//   • a line starting "- " → bullet row (• …)
//   • everything else      → plain paragraph text
//
// Plain (non-markdown) legacy rules render fine — they fall through the
// inline parser untouched and show as ordinary paragraphs. The same
// `parseInlineBold` helper is reused for both bullet and paragraph lines
// so bold works inside bullets too.

import React from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

interface Props {
  /** Raw markdown-lite rules string as stored on the group doc. */
  text: string;
  /** Override the base text style (color / size) per host card. */
  baseStyle?: TextStyle;
}

/**
 * Split a single line into inline spans, toggling bold on each `**`
 * delimiter. Unbalanced trailing `**` is treated as literal text so a
 * half-typed marker never swallows the rest of the line.
 */
function parseInlineBold(line: string, keyPrefix: string): React.ReactNode[] {
  const parts = line.split('**');
  // Even index = normal, odd index = bold. If there's an odd number of
  // delimiters the final (unclosed) chunk stays normal.
  return parts.map((chunk, i) => {
    if (!chunk) return null;
    const bold = i % 2 === 1;
    return (
      <Text
        key={`${keyPrefix}-${i}`}
        style={bold ? styles.bold : undefined}
      >
        {chunk}
      </Text>
    );
  });
}

export function RichRulesText({ text, baseStyle }: Props) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  return (
    <View style={styles.root}>
      {lines.map((rawLine, idx) => {
        const line = rawLine.trimEnd();
        const bulletMatch = /^\s*[-*]\s+(.*)$/.exec(line);

        if (bulletMatch) {
          return (
            <View key={`b-${idx}`} style={styles.bulletRow}>
              <Text style={[styles.base, baseStyle, styles.bulletDot]}>{'•'}</Text>
              <Text style={[styles.base, baseStyle, styles.bulletText]}>
                {parseInlineBold(bulletMatch[1], `b-${idx}`)}
              </Text>
            </View>
          );
        }

        // Preserve blank lines as a little vertical gap so paragraph
        // breaks the admin typed survive into the rendered card.
        if (line.length === 0) {
          return <View key={`s-${idx}`} style={styles.spacer} />;
        }

        return (
          <Text key={`p-${idx}`} style={[styles.base, baseStyle, styles.paragraph]}>
            {parseInlineBold(line, `p-${idx}`)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  base: {
    ...typography.body,
    color: colors.text,
    lineHeight: 22,
    textAlign: RTL_LABEL_ALIGN,
  },
  paragraph: {
    width: '100%',
  },
  bold: {
    fontWeight: '800',
  },
  bulletRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    width: '100%',
    gap: spacing.xs,
  },
  bulletDot: {
    // Sits on the visual RIGHT (start of the RTL row) thanks to
    // row-reverse; the dot leads each bullet.
    fontWeight: '800',
  },
  bulletText: {
    flex: 1,
  },
  spacer: {
    height: spacing.sm,
  },
});
