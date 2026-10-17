// Shared round hero: existing cover resolver and actions, with readable round facts.
import React, {useRef, useState} from 'react';
import {ImageBackground, Pressable, StyleSheet, Text, View} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {Ionicons} from '@expo/vector-icons';
import {colors, RTL_LABEL_ALIGN} from '@/theme';
import {he} from '@/i18n/he';
import {formatDayDate, formatTime} from '@/utils/format';
import {LiveCountdown} from './LiveCountdown';
import type {FieldType} from '@/types';
import {resolveRoundCover} from '@/data/roundCover';

interface Props {
  roundId: string;
  fieldType?: FieldType;
  groupId?: string;
  coverLoading?: boolean;
  startsAt?: number;
  title?: string;
  seasonLabel?: string;
  onMenuPress?: () => void;
  onBackPress: () => void;
  onSharePress?: () => void;
  onChatPress?: () => void;
  /** The screen decides whether the round can still count down. */
  countdownHidden?: boolean;
  showStarted?: boolean;
  chatUnread?: number;
  locationLine?: string;
  coverUrl?: string;
  coverImageId?: string;
  /** Retained for callers of the previous hero layout. */
  compact?: boolean;
  statusLabel?: string;
  /** Includes a pending promotion only when its seat is reserved. */
  occupancy?: {registered: number; capacity: number; reserved?: boolean};
  /** Forecast for the scheduled kickoff; absent data hides the chip. */
  weather?: {icon: keyof typeof Ionicons.glyphMap; description: string; tempC: number; rainProb?: number};
}

export function MatchStadiumHero({roundId, fieldType, groupId, coverLoading = false, startsAt, title,
  seasonLabel, onMenuPress, onBackPress, onSharePress, onChatPress, countdownHidden = false,
  showStarted = false, chatUnread = 0, locationLine, coverUrl, coverImageId,
  statusLabel, occupancy, weather}: Props) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const activePhoto = useRef(coverUrl);
  activePhoto.current = coverUrl;
  const bg = resolveRoundCover({id: roundId, fieldType, groupId, startsAt}, {coverPhotoUrl: coverUrl, coverImageId}, coverLoading, failedPhoto);
  return <View style={styles.wrap}>
    <View style={styles.topBar}>
      <HeaderAction icon="chevron-forward" label="חזור" onPress={onBackPress} />
      <Text style={styles.headerTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{he.matchHeroTitle}</Text>
      <View style={styles.headerActions}>
        {onChatPress ? <HeaderAction icon="chatbubble-ellipses-outline" label={he.chatOpenGame} onPress={onChatPress} count={chatUnread} /> : null}
        {onSharePress ? <HeaderAction icon="share-social-outline" label={he.profileInviteFriendsCta} onPress={onSharePress} /> : null}
        {onMenuPress ? <HeaderAction icon="ellipsis-horizontal" label={he.profileMenuOpen} onPress={onMenuPress} /> : null}
      </View>
    </View>
    <ImageBackground source={bg} resizeMethod="resize" resizeMode="cover" style={styles.photo}
      onError={() => {if (coverUrl && activePhoto.current === coverUrl) setFailedPhoto(coverUrl);}}>
      <LinearGradient colors={['rgba(8,20,34,0.06)', 'rgba(8,20,34,0.35)', 'rgba(8,20,34,0.91)']} style={StyleSheet.absoluteFill} />
      <View style={styles.photoContent}>
        <View style={styles.badges}>
          {statusLabel ? <View style={styles.status}><Text style={styles.statusText}>{statusLabel}</Text></View> : null}
          {weather ? <View style={styles.weather} accessibilityLabel={`תחזית לשעת המחזור: ${weather.tempC} מעלות, ${weather.description}${weather.rainProb != null && weather.rainProb >= 20 ? `, ${weather.rainProb}% סיכוי לגשם` : ''}`}>
            <Ionicons name={weather.icon} size={19} color="#FDE68A" />
            <Text style={styles.weatherText}>{`⁦${weather.tempC}°⁩ · ${weather.description}${weather.rainProb != null && weather.rainProb >= 20 ? ` · ⁦${weather.rainProb}%⁩ גשם` : ''}`}</Text>
          </View> : null}
        </View>
        <View style={styles.bottom}>
        <View style={styles.roundCopy}>
          {title ? <Text style={styles.roundTitle}>{title}</Text> : null}
          {seasonLabel ? <Text style={styles.season}>{seasonLabel}</Text> : null}
          {startsAt ? <View style={styles.when}>
            <View style={styles.date}><Ionicons name="calendar-outline" size={17} color="#FFFFFF" /><Text style={styles.detail}>{formatDayDate(startsAt, {withYear: true})}</Text></View>
            <View style={styles.time}><Ionicons name="time-outline" size={17} color="#FFFFFF" /><Text style={styles.hour}>{`⁦${formatTime(startsAt)}⁩`}</Text></View>
          </View> : null}
          {locationLine ? <View style={styles.place}><Ionicons name="location-outline" size={18} color="#FFFFFF" /><Text style={styles.placeText}>{locationLine}</Text></View> : null}
        </View>
        <View style={styles.footer}>
          {startsAt && !countdownHidden ? <LiveCountdown startsAt={startsAt} /> : null}
          {showStarted ? <View style={styles.started}><Text style={styles.startedText}>{he.gdHeroStarted}</Text><Ionicons name="play-circle" size={14} color="#BBF7D0" /></View> : null}
          {occupancy ? <View style={styles.occupancy}><Ionicons name="people" size={15} color="#18345B" /><Text style={styles.occupancyText}>{occupancy.reserved ? `${occupancy.registered} מתוך ${occupancy.capacity} מקומות תפוסים` : `${occupancy.registered} מתוך ${occupancy.capacity} רשומים`}</Text></View> : null}
        </View>
        </View>
      </View>
    </ImageBackground>
  </View>;
}

function HeaderAction({icon, label, onPress, count = 0}: {icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; count?: number}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={count > 0 ? `${label}, ${count} הודעות שלא נקראו` : label} style={styles.headerAction}>
    <Ionicons name={icon} size={22} color={colors.text} />
    {count > 0 ? <View style={styles.unread}><Text style={styles.unreadText}>{count > 99 ? '99+' : count}</Text></View> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  wrap: {backgroundColor: colors.bg},
  topBar: {flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, minHeight: 48, backgroundColor: colors.surface},
  headerTitle: {flex: 1, fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center'},
  headerActions: {flexDirection: 'row'},
  headerAction: {height: 44, width: 40, alignItems: 'center', justifyContent: 'center'},
  unread: {position: 'absolute', top: 1, end: 0, minWidth: 17, paddingHorizontal: 3, borderRadius: 9, backgroundColor: '#EF4444', alignItems: 'center'},
  unreadText: {fontSize: 10, fontWeight: '700', color: '#FFFFFF'},
  photo: {borderRadius: 20, overflow: 'hidden'},
  photoContent: {padding: 16, minHeight: 230, gap: 10, justifyContent: 'space-between'},
  badges: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 22},
  status: {borderRadius: 18, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#DCFCE7', maxWidth: '100%'},
  statusText: {fontSize: 12, fontWeight: '800', color: '#14532D'},
  weather: {flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 18, backgroundColor: 'rgba(15,23,42,0.78)', flexShrink: 1, maxWidth: '100%'},
  weatherText: {fontSize: 12, lineHeight: 18, fontWeight: '600', color: '#FFFFFF', flexShrink: 1, textAlign: RTL_LABEL_ALIGN},
  bottom: {flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12},
  roundCopy: {gap: 7, flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 180},
  roundTitle: {fontSize: 25, lineHeight: 32, fontWeight: '800', color: '#FFFFFF', textAlign: RTL_LABEL_ALIGN},
  season: {fontSize: 12, color: '#E2E8F0', textAlign: RTL_LABEL_ALIGN},
  when: {flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap'},
  date: {flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1},
  time: {flexDirection: 'row', alignItems: 'center', gap: 5},
  detail: {fontSize: 14, lineHeight: 20, color: '#FFFFFF', flexShrink: 1, textAlign: RTL_LABEL_ALIGN},
  hour: {fontSize: 15, fontWeight: '700', color: '#FFFFFF'},
  place: {flexDirection: 'row', alignItems: 'center', gap: 6},
  placeText: {fontSize: 14, lineHeight: 20, color: '#F1F5F9', flex: 1, textAlign: RTL_LABEL_ALIGN},
  footer: {alignSelf: 'flex-end', alignItems: 'flex-end', marginStart: 'auto', gap: 7, maxWidth: '100%'},
  occupancy: {flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.94)', maxWidth: '100%'},
  occupancyText: {fontSize: 12, lineHeight: 17, fontWeight: '700', color: '#18345B', flexShrink: 1},
  started: {flexDirection: 'row', alignItems: 'center', gap: 5},
  startedText: {fontSize: 12, color: '#BBF7D0', fontWeight: '700'},
});
