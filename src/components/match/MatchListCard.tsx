import React, { useRef, useState } from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Game, FieldType, UserId, activeGuestCount } from '@/types';
import { RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { dayDiff, formatDateShort, formatTime, gameFormatLabel } from '@/utils/format';
import { getCoverSource } from '@/data/coverImages';
import { clubDefaultCoverId } from '@/utils/clubDefaultCoverId';
import { PressableScale } from '@/components/PressableScale';
import { recordDiagnostic } from '@/services/diagnosticJournal';

export type MatchCardCta = 'join' | 'requestJoin' | 'cancel' | 'waitlist' | 'leaveWaitlist' | 'pending' | 'none';
interface Props {
  game: Game;
  userId: UserId;
  onPrimary: (cta: MatchCardCta) => void;
  busy?: boolean;
  /** undefined: club lookup pending; null: resolved without a club cover. */
  cover?: { coverPhotoUrl?: string; coverImageId?: string } | null;
  coverLoading?: boolean;
}
const DEFAULT_COVER = require('../../assets/images/groupImages/park-aerial.jpg');
function statusForUser(
  g: Game,
  uid: UserId,
): 'joined' | 'waitlist' | 'pending' | 'none' {
  if (g.players.includes(uid)) return 'joined';
  if (g.waitlist.includes(uid)) return 'waitlist';
  if ((g.pending ?? []).includes(uid)) return 'pending';
  return 'none';
}

function ctaForGame(
  g: Game,
  status: ReturnType<typeof statusForUser>,
): MatchCardCta {
  if (status === 'joined') return 'cancel';
  if (status === 'waitlist') return 'leaveWaitlist';
  if (status === 'pending') return 'pending';
  if (g.status === 'scheduled') return 'none';
  // Occupancy FIRST. `requiresApproval` used to short-circuit above this, so a
  // full game that happened to require approval still offered "בקש להצטרף" —
  // the request went to the organiser and could only ever be declined, because
  // there was no seat behind it. The one public game in the country is sitting
  // at exactly 21/21 (1 player + 20 active guests) and has collected 7 such
  // requests over 17 days, aged up to 18. Whether a seat exists is a fact about
  // the game; whether an admin must bless it is a fact about the club. The
  // first question has to be asked first.
  const occupancy =
    g.players.length +
    activeGuestCount(g.guests) +
    (g.pendingPromotion?.uid ? 1 : 0);
  if (occupancy >= g.maxPlayers) return 'waitlist';
  if (g.requiresApproval) return 'requestJoin';
  return 'join';
}


function fieldTypeLabel(f: FieldType): string {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  return he.fieldTypeGrass;
}

export function MatchListCard({ game, userId, onPrimary, busy, cover, coverLoading = false }: Props) {
  const nav = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);
  const activePhoto = useRef(cover?.coverPhotoUrl);
  activePhoto.current = cover?.coverPhotoUrl;
  const coverReady = !game.groupId || !coverLoading;
  const source = !coverReady ? undefined : cover?.coverPhotoUrl && cover.coverPhotoUrl !== failedPhotoUrl
    ? { uri: cover.coverPhotoUrl }
    : getCoverSource(cover?.coverImageId) ?? (game.groupId && !game.isOrphanContext ? getCoverSource(clubDefaultCoverId(game.groupId)) : DEFAULT_COVER);
  const status = statusForUser(game, userId);
  const cta = ctaForGame(game, status);
  const occupancy = game.players.length + activeGuestCount(game.guests) + (game.pendingPromotion?.uid ? 1 : 0);
  const spots = Math.max(0, game.maxPlayers - occupancy);
  const ratio = game.maxPlayers > 0 ? Math.max(0, Math.min(1, occupancy / game.maxPlayers)) : 0;
  const diff = dayDiff(game.startsAt);
  const time = formatTime(game.startsAt);
  const when = diff === 0 ? he.matchCardWhenToday(time) : diff === 1
    ? he.matchCardWhenTomorrow(time) : he.matchCardWhenDate(formatDateShort(game.startsAt), time);
  const badge = status === 'joined'
    ? { text: he.roundFeedRegistered, bg: '#DCFCE7', fg: '#166534', icon: 'checkmark-circle' as const }
    : status === 'waitlist'
    ? { text: he.roundFeedWaiting, bg: '#FEF3C7', fg: '#92400E', icon: 'hourglass-outline' as const }
    : status === 'pending'
    ? { text: he.matchStatusPending, bg: '#E2E8F0', fg: '#475569', icon: 'time-outline' as const }
    : { text: game.visibility === 'public' ? he.matchTagOpenToAll : game.isOrphanContext
        ? he.matchTagQuickClosed : he.matchTagCommunityOnly, bg: '#FFFFFF', fg: '#1E40AF', icon: 'people-outline' as const };
  const joinable = cta === 'join' || cta === 'requestJoin' || cta === 'waitlist';
  const visibilityLabel = game.visibility === 'public'
    ? he.matchTagOpenToAll : game.groupId && !game.isOrphanContext ? he.matchTagCommunityOnly : he.matchTagClosedRound;
  const action = cta === 'waitlist' ? he.matchCardWaitlistCta : cta === 'requestJoin'
    ? he.gameCardRequestJoin : he.matchCardJoinFull;
  const openDetails = () => {
    recordDiagnostic('press','open_round',{gameId:game.id,groupId:game.groupId});
    nav.navigate('MatchDetails', { gameId: game.id });
  };
  return (
    <PressableScale onPress={openDetails} style={styles.card} haptic={false}
      accessibilityRole="button" accessibilityLabel={`${game.title}, ${when}, ${badge.text}`}>
      <View style={styles.top}>
        <View style={styles.details}>
          <Text style={styles.when}>{when}</Text>
          <Text style={styles.title} numberOfLines={2}>{game.title}</Text>
          {game.fieldName ? <View style={styles.location}>
            <Ionicons name="location-outline" size={15} color="#64748B" />
            <Text style={styles.locationText} numberOfLines={2}>{game.fieldName}</Text>
          </View> : null}
          <View style={styles.occupancy}>
            <Text style={styles.players}>{he.roundFeedPlayers(occupancy, game.maxPlayers)}</Text>
            <Text style={[styles.spots, !spots && styles.full]}>{he.roundFeedSpaces(spots)}</Text>
          </View>
        </View>
        <ImageBackground key={`${game.groupId ?? 'standalone'}:${cover?.coverPhotoUrl ?? cover?.coverImageId ?? 'pending'}`}
          testID={coverReady ? 'round-cover-ready' : 'round-cover-pending'}
          source={source} resizeMode="cover" resizeMethod="resize" style={styles.photo} imageStyle={styles.photoImage}
          onError={() => {
            if (cover?.coverPhotoUrl && activePhoto.current === cover.coverPhotoUrl) setFailedPhotoUrl(cover.coverPhotoUrl);
          }}>
          {status !== 'none' ? <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.text}</Text>
            <Ionicons name={badge.icon} size={13} color={badge.fg} />
          </View> : null}
        </ImageBackground>
      </View>
      <View style={styles.progress} accessibilityRole="progressbar"
        accessibilityLabel={he.roundFeedPlayers(occupancy, game.maxPlayers)}
        accessibilityValue={{ min: 0, max: Math.max(0, game.maxPlayers), now: Math.min(occupancy, Math.max(0, game.maxPlayers)) }}>
        <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
      </View>
      <View style={styles.bottom}>
        <View style={styles.tags}>
          <Text style={[styles.tag, game.visibility === 'public' && styles.publicTag]}>{visibilityLabel}</Text>
          {game.format ? <Text style={styles.tag}>{gameFormatLabel(game.format).replace(/\s*×\s*/, ' על ')}</Text> : null}
          {game.fieldType ? <Text style={styles.tag}>{fieldTypeLabel(game.fieldType)}</Text> : null}
        </View>
        <Pressable onPress={(e) => { e.stopPropagation(); recordDiagnostic('press','round_primary',{type:cta,gameId:game.id}); joinable ? onPrimary(cta) : openDetails(); }}
          disabled={busy} hitSlop={{ top: 4, bottom: 4 }} accessibilityRole="button" accessibilityState={{ disabled: !!busy, busy: !!busy }}
          style={[styles.action, joinable && styles.join, busy && { opacity: 0.55 }]}>
          <Text style={[styles.actionText, joinable && { color: '#FFFFFF' }]}>
            {joinable ? action : he.roundFeedDetails}
          </Text>
          {!joinable ? <Ionicons name="chevron-back" size={15} color="#1D4ED8" /> : null}
        </Pressable>
      </View>
    </PressableScale>
  );
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, overflow: 'hidden', borderWidth: 1,
    borderColor: '#E8EDF5', elevation: 2, shadowColor: '#122450', shadowOpacity: 0.07,
    shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  top: { flexDirection: 'row', alignItems: 'stretch', minHeight: 126 },
  details: { flex: 1, padding: 12, gap: 4 },
  when: { fontSize: 16, fontWeight: '800', color: '#1D4ED8', textAlign: RTL_LABEL_ALIGN },
  title: { fontSize: 16, fontWeight: '800', color: '#101D3B', textAlign: RTL_LABEL_ALIGN },
  location: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  locationText: { flex: 1, fontSize: 12, color: '#64748B', textAlign: RTL_LABEL_ALIGN },
  occupancy: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2, marginTop: 2 },
  players: { fontSize: 12, color: '#334155', fontWeight: '600', textAlign: RTL_LABEL_ALIGN },
  spots: { fontSize: 11, color: '#15803D', textAlign: RTL_LABEL_ALIGN },
  full: { color: '#B45309' },
  photo: { width: '35%', backgroundColor: '#DCE6F5', overflow: 'hidden', borderRadius: 18, marginBottom: 8 },
  photoImage: { width: '100%', height: '100%', borderRadius: 18 },
  badge: { position: 'absolute', top: 8, end: 8, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7,
    paddingVertical: 5, borderRadius: 20, maxWidth: '90%' },
  badgeText: { fontSize: 10, fontWeight: '800', flexShrink: 1, textAlign: RTL_LABEL_ALIGN },
  // Logical start is the visual RIGHT under forceRTL. Fill grows toward the left.
  progress: { height: 5, backgroundColor: '#E7EEFA', alignItems: 'flex-start', overflow: 'hidden',
    marginHorizontal: 12, marginTop: 2, borderRadius: 3 },
  fill: { height: '100%', backgroundColor: '#2563EB', borderRadius: 3 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  tags: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tag: { fontSize: 10, fontWeight: '700', color: '#475569', backgroundColor: '#EFF3F8',
    paddingHorizontal: 7, paddingVertical: 4, borderRadius: 10 },
  publicTag: { color: '#1D4ED8', backgroundColor: '#EAF2FF' },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
    paddingHorizontal: 10, paddingVertical: 6, minHeight: 36, borderRadius: 10, maxWidth: '49%' },
  join: { backgroundColor: '#2563EB' },
  actionText: { fontSize: 12, fontWeight: '800', color: '#1D4ED8', textAlign: 'center', flexShrink: 1 },
});
