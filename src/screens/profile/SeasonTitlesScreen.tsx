// ארון התארים — the player's own cabinet, on its own screen (§21).
//
// The cabinet itself is not new. `SeasonTitlesShelf` has been reading
// users/{uid}/seasonTitles since the feature shipped, showing every title the
// player has won across every club and every season, each carrying the club's
// name FROZEN at the moment it was won — so a title survives the player
// leaving that club and the club being renamed.
//
// What it did not have was a way in. It rendered above the badge grid inside
// AchievementsScreen, which is a screen about something else: an achievement
// is granted for a milestone, a title was won off other people, once, in a
// competition with an end. A player looking for "what have I actually won"
// had to know to open a screen named after badges and scroll past nothing.
//
// So this screen is a destination, not a rewrite — the same component, given
// its own header and its own entry in the home menu. Deliberately thin: any
// logic added here would be a second copy of the shelf's.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SeasonTitlesShelf } from '@/components/profile/SeasonTitlesShelf';
import { useUserStore } from '@/store/userStore';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export function SeasonTitlesScreen() {
  const user = useUserStore((s) => s.currentUser);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.seasonTitlesShelfTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        {user?.id ? (
          <SeasonTitlesShelf userId={user.id} />
        ) : null}

        {/* The shelf renders nothing at all when the player holds no titles —
            correct inside AchievementsScreen, where the badge grid follows it,
            and wrong here, where it would leave a header over blank space. A
            player who opened a cabinet is owed a sentence either way. */}
        <View style={styles.note}>
          <Text style={styles.noteText}>{he.seasonTitlesCabinetNote}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  note: { marginTop: spacing.md },
  noteText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
});
