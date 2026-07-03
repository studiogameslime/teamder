// FriendsInvitePicker — multi-select of the organizer's friends, shown in
// the quick-game wizard. Selected ids are handed back to the form and
// turned into `inviteToGame` pushes the moment the game is created.
//
// Self-contained: reads the current user + their friends list. Renders an
// empty hint (pointing at the share link / friends screen) when the user
// has no friends yet, so the section never dead-ends.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/Avatar';
import { friendsService } from '@/services/friendsService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import type { User } from '@/types';

interface Props {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Ids to hide from the list — e.g. friends already in the community (members,
   *  pending, admins) so we don't suggest inviting someone who's already in. */
  exclude?: string[];
}

export function FriendsInvitePicker({ selected, onChange, exclude }: Props) {
  const me = useUserStore((s) => s.currentUser);
  const [friends, setFriends] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const excludeSet = React.useMemo(() => new Set(exclude ?? []), [exclude]);
  const visibleFriends = React.useMemo(
    () => friends.filter((f) => !excludeSet.has(f.id)),
    [friends, excludeSet],
  );

  useEffect(() => {
    logEvent(AnalyticsEvent.FriendPickerOpened);
    let alive = true;
    (async () => {
      if (!me) {
        setLoading(false);
        return;
      }
      try {
        const f = await friendsService.listFriends(me.id);
        if (alive) {
          setFriends(f);
          setLoading(false);
        }
      } catch (err) {
        logError('listFriendsForInvite', err, {
          screen: 'FriendsInvitePicker',
          userId: me.id,
        });
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [me]);

  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );

  return (
    <View style={styles.section}>
      <Text style={styles.label}>{he.wizardInviteFriends}</Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
      ) : visibleFriends.length === 0 ? (
        <Text style={styles.empty}>{he.wizardInviteFriendsEmpty}</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {visibleFriends.map((f) => {
            const on = selected.includes(f.id);
            return (
              <Pressable
                key={f.id}
                onPress={() => toggle(f.id)}
                style={styles.chip}
                accessibilityRole="button"
                accessibilityLabel={f.name}
              >
                <View>
                  <Avatar
                    avatarId={f.avatarId}
                    uri={f.photoUrl}
                    name={f.name}
                    size={52}
                    showRing={on}
                    ringColor={colors.primary}
                  />
                  {on ? (
                    <View style={styles.check}>
                      <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.chipName} numberOfLines={1}>
                  {f.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.lg },
  label: {
    ...typography.label,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.sm,
  },
  empty: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  row: { gap: spacing.md, paddingVertical: spacing.xs },
  chip: { alignItems: 'center', width: 64, gap: 4 },
  chipName: {
    ...typography.caption,
    color: colors.text,
    textAlign: 'center',
    width: 64,
  },
  check: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
});
