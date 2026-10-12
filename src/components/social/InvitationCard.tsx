import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/Avatar';
import { RTL_LABEL_ALIGN } from '@/theme';
import { getCoverSource } from '@/data/coverImages';
import { resolveRoundCover } from '@/data/roundCover';
import { clubDefaultCoverId } from '@/utils/clubDefaultCoverId';
import type { ReceivedInvitation } from '@/utils/receivedInvitations';
import type { Game } from '@/types';

export function InvitationCard({ item, busy, disabled, onAccept, onOpen }: {
  item: ReceivedInvitation; busy: boolean; disabled: boolean; onAccept: () => void; onOpen: () => void;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const club = item.type === 'groupInvitation', p = item.preview;
  const cover = club
    ? p?.coverPhotoUrl && p.coverPhotoUrl !== failedPhoto ? { uri: p.coverPhotoUrl } : getCoverSource(p?.coverImageId) ?? getCoverSource(clubDefaultCoverId(item.targetId))
    : resolveRoundCover({ id: item.targetId, groupId: p?.groupId, startsAt: item.startsAt, fieldType: p?.fieldType as Game['fieldType'], isOrphanContext:p?.isOrphanContext }, p, false, failedPhoto);
  const unavailable = ['expired', 'unavailable', 'full', 'scheduled'].includes(item.status ?? '');
  const status = { expired: 'תוקף ההזמנה פג', unavailable: 'ההזמנה כבר אינה זמינה', full: 'המועדון מלא', scheduled: 'ההרשמה למחזור טרם נפתחה', pending: 'בקשת ההצטרפות ממתינה לאישור' };
  const helper = unavailable || item.status === 'pending' ? status[item.status as keyof typeof status]
    : !club && p?.isFull ? 'ההרכב מלא · ההצטרפות לרשימת ההמתנה'
    : item.payload.managerApproved === true ? 'הזמנת מנהל · הצטרפות באישור מראש' : 'הזמנה אישית להצטרף';
  const field = { synthetic: 'סינטטי', grass: 'דשא', asphalt: 'אספלט' }[p?.fieldType ?? ''];
  const location = club ? [p?.city, p?.isOpen === undefined ? '' : p.isOpen ? 'מועדון פתוח' : 'מועדון סגור'].filter(Boolean).join(' · ')
    : [p?.city || p?.fieldName, field].filter(Boolean).join(' · ');
  return <View style={styles.card}>
    <View style={styles.cover}>
      {cover ? <Image source={cover} resizeMode="cover" style={[StyleSheet.absoluteFill, {width:'100%',height:'100%'}]} onError={() => setFailedPhoto(p?.coverPhotoUrl)} accessible={false}/> : null}
      <View style={styles.badge}><Ionicons name={club ? 'shield-outline' : 'calendar-outline'} size={17} color="#0C1744"/><Text style={styles.badgeText}>{club ? 'הזמנה למועדון' : 'הזמנה למחזור'}</Text></View>
    </View>
    <View style={styles.body}>
      <Text style={styles.title}>{item.title || (club ? 'מועדון כדורגל' : 'מחזור כדורגל')}</Text>
      {!club && p?.groupName ? <Text style={styles.subtitle}>{p.groupName}</Text> : null}
      {!club && item.startsAt ? <View style={styles.row}>
        <Ionicons name="calendar-outline" size={17} color="#718099"/><Text style={styles.meta}>{new Date(item.startsAt).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}</Text>
        <Ionicons name="time-outline" size={17} color="#718099"/><Text style={styles.meta}>{new Date(item.startsAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</Text>
      </View> : null}
      {location || p?.format ? <View style={styles.row}>
        {location ? <><Ionicons name="location-outline" size={17} color="#718099"/><Text style={[styles.meta, { flex: 1 }]}>{location}</Text></> : <View style={{flex:1}}/>}
        {!club && p?.format ? <View style={styles.format}><Text style={styles.formatText}>{p.format.replace(/\s*[x×v]\s*/i, ' על ')}</Text></View> : null}
      </View> : null}
      <View style={styles.inviter}>
        <Avatar name={item.inviterName} uri={p?.inviterPhotoUrl} avatarId={p?.inviterAvatarId} size={36}/>
        <View style={{ flex: 1, gap: 3 }}><Text style={styles.inviterName}>{item.inviterName} הזמין אותך {club ? 'להצטרף' : 'לשחק'}</Text>
          <Text style={[styles.helper, !club && p?.isFull && !unavailable && { color: '#99621C' }]}>{helper}</Text></View>
      </View>
      <View style={styles.actions}>
        <Pressable disabled={disabled || unavailable} accessibilityRole="button" accessibilityLabel={club ? 'אישור והצטרפות למועדון' : p?.isFull ? 'אישור והצטרפות לרשימת המתנה' : 'אישור והצטרפות למחזור'} accessibilityState={{ busy, disabled: disabled || unavailable }} onPress={onAccept} style={({pressed}) => [styles.primary, (disabled || unavailable || pressed) && { opacity: 0.55 }]}>
          {busy ? <ActivityIndicator size="small" color="white"/> : null}<Text style={styles.primaryText}>אישור והצטרפות</Text>
        </Pressable>
        <Pressable disabled={disabled || ['expired','unavailable'].includes(item.status ?? '')} accessibilityRole="button" onPress={onOpen} style={({pressed}) => [styles.secondary, (disabled || pressed) && { opacity: 0.55 }]}><Text style={styles.secondaryText}>{club ? 'פרטי המועדון' : 'פרטי המחזור'}</Text></Pressable>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: 'white', borderRadius: 21, borderWidth: 1, borderColor: '#E5EAF2', shadowColor: '#21365C', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cover: { height: 108, borderTopStartRadius: 20, borderTopEndRadius: 20, overflow: 'hidden', backgroundColor: '#E5EDF7' },
  badge: { position:'absolute',start:10,top:10,flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.94)' },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#0C1744' },
  body: { padding: 12, gap: 6 }, title: { color: '#0C1744', fontSize: 20, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  subtitle: { fontSize: 12, color: '#718099', textAlign: RTL_LABEL_ALIGN },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 }, meta: { color: '#66758E', fontSize: 12, fontWeight: '500', textAlign: RTL_LABEL_ALIGN },
  format: { borderRadius: 9, backgroundColor: '#EEF2F8', paddingHorizontal: 9, paddingVertical: 3 }, formatText: { fontSize: 11, color: '#66758E', fontWeight: '700' },
  inviter: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#E7ECF4', paddingTop: 10, marginTop: 3 },
  inviterName: { color: '#0C1744', fontSize: 13, fontWeight: '700', textAlign: RTL_LABEL_ALIGN }, helper: { color: '#718099', fontSize: 11, lineHeight: 16, textAlign: RTL_LABEL_ALIGN },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 }, primary: { flex: 1.15, minHeight: 43, paddingHorizontal: 5, paddingVertical: 10, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#2860F5' },
  primaryText: { fontSize: 13, fontWeight: '700', color: 'white', textAlign: 'center' }, secondary: { flex: 1, minHeight: 43, borderWidth: 1, borderColor: '#2860F5', borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, paddingVertical: 10 }, secondaryText: { fontSize: 13, fontWeight: '700', color: '#2860F5', textAlign: 'center' },
});
