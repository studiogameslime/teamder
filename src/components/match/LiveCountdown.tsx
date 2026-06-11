// LiveCountdown — the "when" answer that gets URGENT as kickoff nears.
// Far out it shows the calm relative string ("עוד 3 שעות", "מחר"); inside
// the final hour it becomes a live ticking MM:SS with a pulsing dot, so an
// imminent game visibly counts down in the hero. Hidden once kicked off.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Breathing } from '@/components/anim/Breathing';
import { relativeKickoff } from '@/utils/format';

const HOUR = 60 * 60 * 1000;

interface Props {
  startsAt: number;
}

export function LiveCountdown({ startsAt }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const remaining = startsAt - nowMs;
  // Tick once a second while we're within 2h (covers the slide into the
  // final-hour urgent state); otherwise stay static to avoid needless work.
  const within2h = remaining > 0 && remaining <= 2 * HOUR;

  useEffect(() => {
    if (!within2h) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [within2h]);

  if (remaining <= 0) return null; // kicked off — the big time stands alone

  const urgent = remaining <= HOUR;

  if (!urgent) {
    const rel = relativeKickoff(startsAt, nowMs);
    if (!rel) return null;
    return (
      <View style={styles.calmChip}>
        <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.85)" />
        <Text style={styles.calmText}>{rel}</Text>
      </View>
    );
  }

  const totalSec = Math.floor(remaining / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;

  return (
    <Breathing mode="pulse" amount={0.05} periodMs={1000} active>
      <View style={styles.urgentChip}>
        <View style={styles.dot} />
        <Text style={styles.urgentLabel}>עוד</Text>
        <Text style={styles.urgentTime}>
          {mm}:{String(ss).padStart(2, '0')}
        </Text>
      </View>
    </Breathing>
  );
}

const styles = StyleSheet.create({
  calmChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  calmText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '700',
  },
  urgentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(239,68,68,0.92)',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  urgentLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '700',
  },
  urgentTime: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
});
