// Edits the user's availability (preferred days / time range / city /
// invitable toggle) and persists it via userService.updateProfile.
//
// Phase 5 scope: form-only. The data is read by Game create + Player Card
// "Invite to Game" matching when those features ship. We don't show
// explicit feedback if the user has never set availability — defaults to
// no days selected, empty time range, empty city, invitable=true.

import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { updateDoc } from 'firebase/firestore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { AppTimeField } from '@/components/DateTimeFields';
import { userService } from '@/services';
import { storage } from '@/services/storage';
import { docs } from '@/firebase/firestore';
import { USE_MOCK_DATA } from '@/firebase/config';
import { UserAvailability, WeekdayIndex } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

const ALL_DAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];

export function AvailabilityEditScreen() {
  const nav = useNavigation();
  const user = useUserStore((s) => s.currentUser);
  // Pull the action out of the store so we can refresh on save.
  const reloadUser = async () => {
    const fresh = await userService.getCurrentUser();
    if (fresh) {
      // userStore uses immutable state; this re-set keeps store in sync.
      useUserStore.setState({ currentUser: fresh });
    }
  };

  const initial: UserAvailability = user?.availability ?? {
    preferredDays: [],
    timeFrom: '',
    timeTo: '',
    preferredCity: '',
    isAvailableForInvites: true,
  };

  const [days, setDays] = useState<WeekdayIndex[]>(initial.preferredDays ?? []);
  const [timeFrom, setTimeFrom] = useState<string>(initial.timeFrom ?? '');
  const [timeTo, setTimeTo] = useState<string>(initial.timeTo ?? '');
  const [city, setCity] = useState<string>(initial.preferredCity ?? '');
  const [invitable, setInvitable] = useState<boolean>(
    initial.isAvailableForInvites !== false
  );
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const toggleDay = (d: WeekdayIndex) => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      const next: UserAvailability = {
        preferredDays: days,
        timeFrom: timeFrom.trim() || undefined,
        timeTo: timeTo.trim() || undefined,
        preferredCity: city.trim() || undefined,
        isAvailableForInvites: invitable,
      };
      // userService.updateProfile accepts only name/avatarId; availability
      // needs its own write. We piggyback by writing through a thin direct
      // call so we don't have to grow updateProfile's surface for one field.
      await persistAvailability(user.id, next);
      await reloadUser();
      nav.goBack();
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.availabilityTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{he.availabilityIntro}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>{he.availabilityDays}</Text>
          <View style={styles.daysRow}>
            {ALL_DAYS.map((d) => {
              const active = days.includes(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDay(d)}
                  style={({ pressed }) => [
                    styles.dayPill,
                    active && styles.dayPillActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayPillText,
                      active && { color: colors.primary, fontWeight: '700' },
                    ]}
                  >
                    {he.availabilityDayShort[d]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <AppTimeField
          label={he.availabilityTimeFrom}
          value={timeFrom}
          onChange={setTimeFrom}
        />
        <AppTimeField
          label={he.availabilityTimeTo}
          value={timeTo}
          onChange={setTimeTo}
        />

        <View style={styles.field}>
          <Text style={styles.label}>{he.availabilityCity}</Text>
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="תל אביב"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            textAlign="right"
          />
          <Text style={styles.hint}>{he.availabilityCityHint}</Text>
        </View>

        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{he.availabilityInvitable}</Text>
            <Text style={styles.hint}>{he.availabilityInvitableHint}</Text>
          </View>
          <Switch
            value={invitable}
            onValueChange={setInvitable}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
      </ScrollView>

      <View style={{ padding: spacing.lg }}>
        <Button
          title={he.availabilitySave}
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          onPress={save}
        />
      </View>
    </SafeAreaView>
  );
}

// ── Persistence helper ────────────────────────────────────────────────────
// Writes only the `availability` field. We don't add a method to userService
// because availability lives entirely on the user doc and there's nothing
// non-trivial in the write logic — keeping it inline avoids over-growing
// the service surface for a single screen.

async function persistAvailability(
  uid: string,
  availability: UserAvailability
): Promise<void> {
  if (USE_MOCK_DATA) {
    const json = await storage.getAuthUserJson();
    if (!json) return;
    try {
      const cur = JSON.parse(json);
      const next = { ...cur, availability, updatedAt: Date.now() };
      await storage.setAuthUserJson(JSON.stringify(next));
    } catch {
      /* corrupt cache — leave alone */
    }
    return;
  }
  await updateDoc(docs.user(uid), {
    availability: {
      preferredDays: availability.preferredDays,
      timeFrom: availability.timeFrom ?? null,
      timeTo: availability.timeTo ?? null,
      preferredCity: availability.preferredCity ?? null,
      isAvailableForInvites: availability.isAvailableForInvites !== false,
    },
    updatedAt: Date.now(),
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  intro: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'right',
    marginBottom: spacing.sm,
  },
  field: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textMuted },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  daysRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  dayPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 44,
    alignItems: 'center',
  },
  dayPillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  dayPillText: { ...typography.body, color: colors.textMuted },

  timeRow: { flexDirection: 'row', gap: spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
});
