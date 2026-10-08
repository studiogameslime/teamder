import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';
import type { Review } from '../types';
import { timeAgo } from '../format';
import { Card, SourceBadge, StarRow } from './ui';

export function ReviewItem({ review }: { review: Review }) {
  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <StarRow rating={review.rating} />
        <View style={{ flex: 1 }} />
        <SourceBadge source={review.source} />
      </View>
      {review.title ? <Text style={styles.title}>{review.title}</Text> : null}
      {review.body ? <Text style={styles.body}>{review.body}</Text> : null}
      <View style={styles.meta}>
        <Text style={styles.metaText}>{review.author}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{timeAgo(review.createdAt)}</Text>
        {review.territory ? (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{review.territory}</Text>
          </>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center' },
  title: { ...font.title, fontSize: 15 },
  body: { ...font.body, color: colors.text, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  metaText: { ...font.small },
  metaDot: { color: colors.textMuted },
});
