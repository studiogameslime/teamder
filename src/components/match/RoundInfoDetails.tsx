import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { getCoverSource } from '@/data/coverImages';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { formatDateShortYear, gameFormatLabel } from '@/utils/format';
import type { Game, User } from '@/types';

export function RoundGameFacts({game}: {game: Pick<Game, 'format' | 'fieldType' | 'matchDurationMinutes'>}) {
  const items: {icon: keyof typeof Ionicons.glyphMap; text: string}[] = [];
  if (game.format) items.push({icon: 'football-outline', text: gameFormatLabel(game.format).replace(/ /g, '')});
  if (game.fieldType) items.push({icon: 'leaf-outline', text: game.fieldType === 'synthetic' ? he.fieldTypeSynthetic : game.fieldType === 'asphalt' ? he.fieldTypeAsphalt : he.fieldTypeGrass});
  if (typeof game.matchDurationMinutes === 'number' && game.matchDurationMinutes > 0) items.push({icon: 'stopwatch-outline', text: he.gdDetailDuration(game.matchDurationMinutes)});
  if (!items.length) return null;
  return <View style={styles.facts}>{items.map(item => <View key={item.icon} style={styles.fact}>
      <Ionicons name={item.icon} size={22} color={colors.primary} />
      <Text style={styles.factText}>{item.text}</Text>
    </View>)}</View>;
}

type Identity = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
export function RoundPeopleCard({club, organizer, createdAt, onClub, onOrganizer}: {
  club?: {name: string; coverPhotoUrl?: string; coverImageId?: string};
  organizer?: Identity;
  createdAt?: number;
  onClub?: () => void;
  onOrganizer?: () => void;
}) {
  if (!club && !organizer && !createdAt) return null;
  return <View style={styles.people}>
    {club ? <PersonRow label="מועדון" name={club.name} onPress={onClub}>
      <ClubPortrait key={`${club.coverPhotoUrl}:${club.coverImageId}`} club={club} />
    </PersonRow> : null}
    {organizer ? <PersonRow label="יוצר המחזור" name={organizer.name} onPress={onOrganizer} divider={!!club}>
      <UserAvatar user={organizer} size={40} />
    </PersonRow> : null}
    {createdAt ? <PersonRow label="נוצר בתאריך" name={formatDateShortYear(createdAt)} divider={!!club || !!organizer}>
      <View style={styles.clubFallback}><Ionicons name="calendar-outline" size={23} color={colors.primary} /></View>
    </PersonRow> : null}
  </View>;
}

function ClubPortrait({club}: {club: {coverPhotoUrl?: string; coverImageId?: string}}) {
  const [failed, setFailed] = React.useState(false);
  const source = club.coverPhotoUrl && !failed ? {uri: club.coverPhotoUrl} : getCoverSource(club.coverImageId);
  return source ? <Image source={source} style={styles.clubPhoto} onError={() => setFailed(true)} /> :
    <View style={styles.clubFallback}><Ionicons name="shield-outline" size={25} color={colors.primary} /></View>;
}

function PersonRow({label, name, onPress, divider, children}: {label: string; name: string; onPress?: () => void; divider?: boolean; children: React.ReactNode}) {
  const content = <>{children}<View style={styles.personCopy}>
    <Text style={styles.label}>{label}</Text><Text style={styles.personName}>{name}</Text>
  </View>{onPress ? <Ionicons name="chevron-back" size={19} color={colors.textMuted} /> : null}</>;
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${name}`} style={[styles.personRow, divider && styles.divider]}>{content}</Pressable> :
    <View style={[styles.personRow, divider && styles.divider]}>{content}</View>;
}

const styles = StyleSheet.create({
  facts: {flexDirection: 'row', gap: 8},
  fact: {flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 5, gap: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EDF4FF', borderRadius: 16},
  factText: {fontSize: 14, lineHeight: 20, fontWeight: '700', color: colors.text, textAlign: 'center'},
  people: {borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden'},
  personRow: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 70},
  personCopy: {flex: 1, minWidth: 0, gap: 3},
  label: {fontSize: 12, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN},
  personName: {fontSize: 16, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN},
  divider: {borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  clubPhoto: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDF4FF'},
  clubFallback: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDF4FF', alignItems: 'center', justifyContent: 'center'},
});
