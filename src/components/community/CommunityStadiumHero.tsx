// Shared member/public club hero; cover selection and permissions remain with callers.
import React from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View, type ImageSourcePropType} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {Ionicons} from '@expo/vector-icons';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, RTL_LABEL_ALIGN} from '@/theme';
import {he} from '@/i18n/he';
import {getCoverSource} from '@/data/coverImages';
import {clubDefaultCoverId} from '@/utils/clubDefaultCoverId';
import {CoverCrossfade} from '@/components/anim/CoverCrossfade';

interface Props {
  groupId?: string;
  name: string;
  city?: string;
  /** Number of approved community members. Drives the pill badge. */
  memberCount: number;
  /**
   * Admin-uploaded cover photo (Storage download URL). When present it
   * replaces the bundled default stadium image. Falls back to the
   * default when undefined/empty.
   */
  coverUrl?: string;
  /** Built-in gallery cover id (used when there's no uploaded coverUrl). */
  coverImageId?: string;
  /** Show the camera edit affordance (coaches only). */
  canEditCover?: boolean;
  /** Spinner over the edit button while an upload is in flight. */
  uploadingCover?: boolean;
  onBackPress: () => void;
  /**
   * Omitted for a visitor: every item in that menu is a member or admin
   * action, so the button would open an empty sheet. A control that does
   * nothing is worse than no control.
   */
  onMenuPress?: () => void;
  onEditCoverPress?: () => void;
  /** Members only — opens the community chat. Hidden when undefined. */
  onChatPress?: () => void;
}


export function CommunityStadiumHero({groupId, name, city, memberCount, coverUrl, coverImageId,
  canEditCover = false, uploadingCover = false, onBackPress, onMenuPress, onEditCoverPress, onChatPress}: Props) {
  const source: ImageSourcePropType = coverUrl ? {uri: coverUrl}
    : getCoverSource(coverImageId) ?? getCoverSource(clubDefaultCoverId(groupId))!;
  return <View style={styles.wrap}>
    <SafeAreaView edges={['top']} style={styles.header}>
      <View style={styles.topBar}>
        <HeaderAction icon="chevron-forward" label="חזור" onPress={onBackPress} />
        <Text style={styles.headerTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>פרטי מועדון</Text>
        <View style={styles.actions}>
          {onChatPress ? <HeaderAction icon="chatbubble-ellipses-outline" label={he.chatOpenCommunity} onPress={onChatPress} /> : null}
          {onMenuPress ? <HeaderAction icon="ellipsis-horizontal" label={he.profileMenuOpen} onPress={onMenuPress} /> : null}
        </View>
      </View>
    </SafeAreaView>
    <View style={styles.photo}>
      <CoverCrossfade source={source} imageKey={coverUrl || coverImageId || clubDefaultCoverId(groupId)}
        fallbackSource={getCoverSource(coverImageId) ?? getCoverSource(clubDefaultCoverId(groupId))!} />
      <LinearGradient colors={['rgba(8,20,34,0.06)', 'rgba(8,20,34,0.35)', 'rgba(8,20,34,0.91)']} style={StyleSheet.absoluteFill} />
      <View style={styles.photoContent}>
        <View style={styles.photoActions}>
          {canEditCover ? <Pressable onPress={onEditCoverPress} disabled={uploadingCover}
            accessibilityRole="button" accessibilityLabel={he.communityCoverChange}
            accessibilityState={{disabled: uploadingCover, busy: uploadingCover}}
            style={({pressed}) => [styles.coverEdit, (pressed || uploadingCover) && {opacity: 0.7}]}>
            {uploadingCover ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="camera-outline" size={18} color="#FFFFFF" />}
            <Text style={styles.coverEditText}>{uploadingCover ? he.communityCoverUploading : he.communityCoverChange}</Text>
          </Pressable> : null}
        </View>
        <View style={styles.bottom}>
          <View style={styles.identity}>
            <Text style={styles.name}>{name}</Text>
            {city ? <View style={styles.place}><Ionicons name="location-outline" size={18} color="#FFFFFF" /><Text style={styles.city}>{city}</Text></View> : null}
          </View>
          <View style={styles.memberPill}>
            <Ionicons name="people" size={15} color="#18345B" />
            <Text style={styles.memberText}>{he.communityMembersCount(memberCount)}</Text>
          </View>
        </View>
      </View>
    </View>
  </View>;
}

function HeaderAction({icon, label, onPress}: {icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.headerAction}>
    <Ionicons name={icon} size={22} color={colors.text} />
  </Pressable>;
}

const styles = StyleSheet.create({
  wrap: {backgroundColor: colors.bg},
  header: {backgroundColor: colors.surface},
  topBar: {flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, minHeight: 48},
  headerTitle: {flex: 1, fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center'},
  actions: {flexDirection: 'row'},
  headerAction: {height: 44, width: 40, alignItems: 'center', justifyContent: 'center'},
  photo: {borderRadius: 20, overflow: 'hidden'},
  photoContent: {padding: 16, minHeight: 230, gap: 10, justifyContent: 'space-between'},
  photoActions: {minHeight: 44, flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 22},
  coverEdit: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, minHeight: 44, borderRadius: 22, backgroundColor: 'rgba(15,23,42,0.38)', flexShrink: 1},
  coverEditText: {color: '#FFFFFF', fontSize: 12, lineHeight: 18, fontWeight: '700', flexShrink: 1, textAlign: RTL_LABEL_ALIGN},
  bottom: {flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12},
  identity: {gap: 7, flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 180},
  name: {fontSize: 25, lineHeight: 32, fontWeight: '800', color: '#FFFFFF', textAlign: RTL_LABEL_ALIGN},
  place: {flexDirection: 'row', alignItems: 'center', gap: 6},
  city: {fontSize: 14, lineHeight: 20, color: '#F1F5F9', flex: 1, textAlign: RTL_LABEL_ALIGN},
  memberPill: {alignSelf: 'flex-end', marginStart: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.94)', maxWidth: '100%'},
  memberText: {fontSize: 12, lineHeight: 17, fontWeight: '700', color: '#18345B', flexShrink: 1},
});
