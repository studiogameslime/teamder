import React from 'react';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { FieldType, GameFormat } from '@/types';
import { dayDiff, formatDayDate, formatGameDay, formatTime,
  gameFormatLabel,
} from '@/utils/format';

interface Props {
  /** Public preview shares the card design but never opens private round details. */
  publicPreview?: boolean;
  coverSource?: ImageSourcePropType;
  onCoverError?: () => void;
  /** ms epoch — undefined when there is no upcoming game. */
  startsAt?: number;
  fieldName?: string;
  /** When set (and in the future), registration hasn't opened yet. */
  registrationOpensAt?: number;
  onPress?: () => void;
  onCreateRecurring?: () => void;
  // Quick-stats strip inputs (all optional — cells with no data are dropped).
  playersCount?: number;
  maxPlayers?: number;
  format?: GameFormat;
  fieldType?: FieldType;
}


function fieldTypeLabel(f: FieldType | undefined): string | null {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  if (f === 'grass') return he.fieldTypeGrass;
  return null;
}

/** Short relative countdown chip ("עוד 3 שעות" / "מחר" / …). null when the game
 *  has already started or is >7 days out (the date line already carries that). */
function countdownLabel(ms: number): string | null {
  const diff = ms - Date.now();
  if (diff <= 0) return null;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return he.communityNextGameInMin(Math.max(1, mins));
  const hrs = Math.round(diff / 3_600_000);
  if (hrs < 24) return he.communityNextGameInHours(hrs);
  const days = Math.round(diff / 86_400_000);
  if (days === 1) return he.communityNextGameTomorrow;
  if (days <= 7) return he.communityNextGameInDays(days);
  return null;
}

export function NextGameCard({
  startsAt,
  fieldName,
  registrationOpensAt,
  onPress,
  onCreateRecurring,
  playersCount,
  maxPlayers,
  format,
  fieldType,
  publicPreview,
  coverSource,
  onCoverError,
}: Props) {
  const hasGame = typeof startsAt === 'number';
  if (!hasGame) return <View style={preview.card}>
    <View style={preview.top}>
      <View style={preview.details}>
        <View style={preview.row}><Ionicons name="calendar-outline" size={22} color="#0B1942"/><Text style={preview.heading}>{he.communityNextGameEyebrow}</Text></View>
        <Text style={preview.location}>{he.communityNextGameNone}</Text>
      </View>
      <View style={[preview.photo, preview.emptyPhoto]} accessible={false}>
        <Svg width={112} height={90} viewBox="0 0 112 90">
          <Circle cx={56} cy={45} r={39} fill="#D1E5FC" />
          <Rect x={22} y={17} width={68} height={59} rx={11} fill="#FFFFFF" stroke="#8CB7EB" strokeWidth={2} />
          <Path d="M33 17H79Q90 17 90 28V33H22V28Q22 17 33 17Z" fill="#2861F4" />
          <Path d="M38 12V23M74 12V23" stroke="#0B1942" strokeWidth={4} strokeLinecap="round" />
          <Rect x={32} y={41} width={48} height={26} rx={3} fill="#E8F5EF" stroke="#60A58D" strokeWidth={1.5} />
          <Line x1={56} y1={41} x2={56} y2={67} stroke="#60A58D" strokeWidth={1.5} />
          <Circle cx={56} cy={54} r={7} fill="none" stroke="#60A58D" strokeWidth={1.5} />
          <Path d="M32 48H38V60H32M80 48H74V60H80" fill="none" stroke="#60A58D" strokeWidth={1.5} />
        </Svg>
      </View>
    </View>
    {onCreateRecurring ? <Pressable style={preview.cta} accessibilityRole="button" accessibilityLabel={he.communityNextGameCreateRecurring} onPress={onCreateRecurring}><Text style={preview.ctaText}>{he.communityNextGameCreateRecurring}</Text><Ionicons name="repeat" size={18} color="#FFFFFF"/></Pressable> : null}
  </View>;
  const isDeferred =
    typeof registrationOpensAt === 'number' &&
    registrationOpensAt > Date.now();
  const countdown = hasGame && !isDeferred ? countdownLabel(startsAt!) : null;

  // Quick-stats — only cells with real data survive.
  const stats: Array<{ n: string; t: string }> = [];
  if (typeof playersCount === 'number') {
    stats.push({
      n: maxPlayers ? `${playersCount}/${maxPlayers}` : String(playersCount),
      t: he.communityNextGameStatPlayers,
    });
  }
  const fmt = format ? gameFormatLabel(format) : null;
  if (fmt) stats.push({ n: fmt, t: he.communityNextGameStatFormat });
  const field = fieldTypeLabel(fieldType);
  if (field) stats.push({ n: field, t: he.communityNextGameStatField });

  if (hasGame) {
    const content = <>
      <View style={preview.top}>
        <View style={preview.details}>
          <View style={preview.row}><Ionicons name="calendar-outline" size={22} color="#0B1942"/><Text style={preview.heading}>{he.communityNextGameEyebrow}</Text></View>
          {countdown ? <View style={preview.chip}><Ionicons name="time-outline" size={15} color="#2861F4"/><Text style={preview.chipText}>{countdown}</Text></View> : null}
          <Text style={preview.date}>{formatDayDate(startsAt!)}</Text>
          <Text style={preview.time}>{formatTime(startsAt!)}</Text>
          {fieldName ? <View style={preview.row}><Ionicons name="location-outline" size={18} color="#304D79"/><Text style={preview.location}>{fieldName}</Text></View> : null}
        </View>
        <View style={preview.photo}><Image source={coverSource} onError={onCoverError} style={preview.image} resizeMode="cover" accessibilityIgnoresInvertColors /></View>
      </View>
      {stats.length ? <View style={preview.stats}>{stats.map((s, i) => <View key={s.t} style={[preview.stat, i > 0 && preview.separator]}>
        <Ionicons name={s.t === he.communityNextGameStatPlayers ? 'people-outline' : s.t === he.communityNextGameStatFormat ? 'football-outline' : 'leaf-outline'} size={23} color="#0B1942"/>
        <Text style={preview.value}>{s.n}</Text><Text style={preview.caption}>{s.t}</Text>
      </View>)}</View> : null}
      {!publicPreview && isDeferred ? <View style={[preview.cta, preview.locked]}>
        <Ionicons name="lock-closed-outline" size={18} color="#304D79" />
        <Text style={preview.lockedText}>{he.communityNextGameLockedBody(formatLockTime(registrationOpensAt!))}</Text>
      </View> : !publicPreview && onPress ? <View style={preview.cta}>
        <Text style={preview.ctaText}>{he.communityNextGameFullCta}</Text>
        <Ionicons name="chevron-back" size={18} color="#FFFFFF" />
      </View> : null}
    </>;
    return !publicPreview && onPress ? <Pressable onPress={onPress} style={({pressed}) => [preview.card, pressed && {opacity: 0.92}]}
      accessibilityRole="button" accessibilityLabel={isDeferred ? he.communityNextGameLocked : he.communityNextGameDetailsCta}>{content}</Pressable>
      : <View style={preview.card}>{content}</View>;
  }

  const inner = (
    <View style={styles.inner}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>{he.communityNextGameEyebrow}</Text>
        {countdown ? (
          <View style={styles.chip}>
            <Ionicons name="time-outline" size={13} color="#FFFFFF" />
            <Text style={styles.chipText}>{countdown}</Text>
          </View>
        ) : null}
      </View>

      <>
          <Text style={styles.emptyLine}>{he.communityNextGameNone}</Text>
          {onCreateRecurring ? (
            <Pressable
              onPress={onCreateRecurring}
              style={({ pressed }) => [
                styles.createCta,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.communityNextGameCreateRecurring}
            >
              <Text style={styles.createCtaText}>
                {he.communityNextGameCreateRecurring}
              </Text>
              <Ionicons name="repeat" size={18} color="#FFFFFF" />
            </Pressable>
          ) : null}
      </>
    </View>
  );

  const gradient = (
    <LinearGradient
      colors={['#1E3A8A', '#1E40AF', '#0F172A']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );

  return <View style={styles.card}>{gradient}{inner}</View>;
}

/**
 * The phrase that follows "ההרשמה תיפתח" — WITH its preposition when it needs
 * one, and without when it does not.
 *
 * `formatGameDay` answers "היום" or "מחר" for the near days and a date for the
 * rest, and only the date takes "ב-". The sentence used to carry the prefix
 * itself, so a registration opening today read "ההרשמה תיפתח ב-היום 20:00".
 */
function formatLockTime(ms: number): string {
  const diff = dayDiff(ms);
  const near = diff === 0 || diff === 1;
  return `${near ? '' : 'ב-'}${formatGameDay(ms)} ${formatTime(ms)}`;
}

const preview = StyleSheet.create({
  cta: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#2861F4', paddingVertical: 13, paddingHorizontal: 12, borderRadius: 16, minHeight: 48},
  ctaText: {color: '#FFFFFF', fontSize: 15, fontWeight: '800', flexShrink: 1, textAlign: 'center'},
  locked: {backgroundColor: '#DDEBFA'},
  lockedText: {color: '#304D79', fontSize: 13, lineHeight: 19, fontWeight: '700', flexShrink: 1, textAlign: RTL_LABEL_ALIGN},
  card: { padding: 14, borderRadius: 24, borderWidth: 1, borderColor: '#CBE5FF', backgroundColor: '#EDF6FF', gap: 12 },
  top: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  details: { flex: 1.2, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heading: { fontSize: 17, fontWeight: '800', color: '#0B1942', flexShrink: 1, textAlign: RTL_LABEL_ALIGN },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, backgroundColor: '#D7E9FF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  chipText: { color: '#2861F4', fontSize: 12, fontWeight: '700' },
  date: { color: '#0B1942', fontSize: 14, textAlign: RTL_LABEL_ALIGN },
  time: { color: '#0B1942', fontSize: 30, fontWeight: '900', textAlign: RTL_LABEL_ALIGN },
  location: { color: '#304D79', fontSize: 14, flexShrink: 1, textAlign: RTL_LABEL_ALIGN },
  photo: { flex: 1, minHeight: 150, borderRadius: 16, overflow: 'hidden', backgroundColor: '#DBEAFE' },
  emptyPhoto: { minHeight: 90, alignItems: 'center', justifyContent: 'center' },
  image: { position: 'absolute', width: '100%', height: '100%' },
  stats: { flexDirection: 'row', backgroundColor: '#F8FBFF', borderRadius: 16, paddingVertical: 10 },
  stat: { flex: 1, alignItems: 'center', gap: 3, paddingHorizontal: 4 },
  separator: { borderStartWidth: 1, borderStartColor: '#D5E5F9' },
  value: { fontSize: 17, fontWeight: '800', color: '#0B1942', textAlign: 'center' },
  caption: { fontSize: 12, color: '#607496', textAlign: 'center' },
});

const styles = StyleSheet.create({
  card: {overflow: 'hidden', borderRadius: 22, elevation: 3},
  inner: {padding: spacing.lg},
  headerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6},
  eyebrow: {color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '800', textAlign: RTL_LABEL_ALIGN},
  chip: {flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4},
  chipText: {color: '#FFFFFF', fontSize: 12, fontWeight: '800'},
  emptyLine: {color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: RTL_LABEL_ALIGN, marginTop: 6},
  createCta: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.16)', paddingVertical: 12, borderRadius: 12, marginTop: 14},
  createCtaText: {color: '#FFFFFF', fontSize: 14, fontWeight: '700'},
});
