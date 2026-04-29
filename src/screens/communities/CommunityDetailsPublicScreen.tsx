// CommunityDetailsPublicScreen — non-member preview of a community.
//
// Reads /groupsPublic/{id} ONLY. Never touches /groups/{id} (which is
// read-restricted to members + admins by Firestore rules). The fields we
// show match what's serialized into GroupPublic by groupPublicConverter:
//   name, city, fieldName, fieldAddress, description,
//   preferredDays, preferredHour, costPerGame,
//   memberCount, isOpen, contactPhone.
//
// Hidden by design: members list, admin list, pendingPlayerIds — anything
// that would expose private community membership. Once the user joins,
// PublicGroupsFeedScreen will navigate to the private CommunityDetails
// instead, which has the full member roster.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { toast } from '@/components/Toast';
import { groupService } from '@/services';
import {
  isValidIsraeliPhone,
  openWhatsApp,
} from '@/services/whatsappService';
import { GroupPublic, WeekdayIndex } from '@/types';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<
  CommunitiesStackParamList,
  'CommunityDetailsPublic'
>;
type Params = RouteProp<CommunitiesStackParamList, 'CommunityDetailsPublic'>;

function formatDays(days: WeekdayIndex[] | undefined): string {
  if (!days || days.length === 0) return '';
  return days
    .slice()
    .sort()
    .map((d) => he.availabilityDayShort[d])
    .join(', ');
}

export function CommunityDetailsPublicScreen() {
  const nav = useNavigation<Nav>();
  const { groupId } = useRoute<Params>().params;
  const me = useUserStore((s) => s.currentUser);
  const pendingGroups = useGroupStore((s) => s.pendingGroups);
  const memberGroups = useGroupStore((s) => s.groups);
  const requestJoinById = useGroupStore((s) => s.requestJoinById);

  const [group, setGroup] = useState<GroupPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyJoin, setBusyJoin] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const g = await groupService.getPublic(groupId);
      setGroup(g);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );
  useEffect(() => {
    reload();
  }, [reload]);

  // If the user is already a member, bounce to the private full screen.
  // (They might land here via a shared link or after backgrounding the
  // app at the moment they got approved.)
  useEffect(() => {
    if (memberGroups.some((g) => g.id === groupId)) {
      nav.replace('CommunityDetails', { groupId });
    }
  }, [memberGroups, groupId, nav]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.loading} />
        <SoccerBallLoader size={40} style={{ marginTop: spacing.lg }} />
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.loading} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.communitiesEmpty}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isPending = pendingGroups.some((g) => g.id === group.id);
  const phoneValid =
    !!group.contactPhone && isValidIsraeliPhone(group.contactPhone);

  const handleJoin = async () => {
    if (!me || isPending) return;
    setBusyJoin(true);
    try {
      const status = await requestJoinById(group.id, me.id);
      if (status === 'pending') {
        logEvent(AnalyticsEvent.GroupJoinRequested, { groupId: group.id });
        toast.success(
          group.isOpen ? he.toastJoinSuccess : he.toastJoinRequestSent,
        );
        nav.goBack();
      } else if (status === 'already_member') {
        toast.info(he.groupAlreadyMember);
      }
    } catch (err) {
      if (__DEV__) console.warn('[communityPublic] join failed', err);
      toast.error(he.toastRequestFailed);
    } finally {
      setBusyJoin(false);
    }
  };

  const days = formatDays(group.preferredDays);
  // CTA label depends on `isOpen` — auto-join vs admin approval.
  const cta = group.isOpen ? he.communityJoinAuto : he.communityRequestToJoin;
  const ctaDisabled = isPending || busyJoin;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={group.name} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{he.communityDetailsAbout}</Text>
          {group.description ? (
            <Text style={styles.bodyText}>{group.description}</Text>
          ) : null}
          <MetaRow
            icon="location-outline"
            label={he.communityDetailsCity}
            value={[group.city, group.fieldAddress].filter(Boolean).join(', ')}
          />
          <MetaRow
            icon="football-outline"
            label={he.communityDetailsField}
            value={group.fieldName}
          />
          {days ? (
            <MetaRow
              icon="calendar-outline"
              label={he.communityDetailsPreferredDays}
              value={days}
            />
          ) : null}
          {group.preferredHour ? (
            <MetaRow
              icon="time-outline"
              label={he.communityDetailsPreferredHour}
              value={group.preferredHour}
            />
          ) : null}
          <MetaRow
            icon="people-outline"
            label={he.communityDetailsMembers}
            value={he.communityMembersCount(group.memberCount)}
          />
        </Card>

        {phoneValid ? (
          <Button
            title={he.communityDetailsContactAdmin}
            variant="outline"
            size="lg"
            fullWidth
            iconLeft="logo-whatsapp"
            onPress={() => openWhatsApp(group.contactPhone)}
          />
        ) : null}

        <Button
          title={isPending ? he.groupsActionPending : cta}
          variant="primary"
          size="lg"
          fullWidth
          loading={busyJoin}
          disabled={ctaDisabled}
          onPress={handleJoin}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  if (!value) return null;
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={14} color={colors.textMuted} />
      <Text style={styles.metaLabel}>{label}:</Text>
      <Text style={styles.metaValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  section: { gap: spacing.xs },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'right',
    marginBottom: spacing.xs,
  },
  bodyText: {
    ...typography.body,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  metaValue: {
    ...typography.caption,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
