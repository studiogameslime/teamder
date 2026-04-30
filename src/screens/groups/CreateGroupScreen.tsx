import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { InputField } from '@/components/InputField';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { AppTimeField } from '@/components/DateTimeFields';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import {
  searchCities,
  searchStreets,
} from '@/services/israelLocationService';
import { isValidIsraeliPhone } from '@/services/whatsappService';
import { WeekdayIndex } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';

const ALL_DAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];

export function CreateGroupScreen() {
  const nav = useNavigation<
    NativeStackNavigationProp<CommunitiesStackParamList, 'CommunitiesCreate'>
  >();
  const user = useUserStore((s) => s.currentUser);
  const createGroup = useGroupStore((s) => s.createGroup);

  const [name, setName] = useState('');
  const [fieldName, setFieldName] = useState('');
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [addressNote, setAddressNote] = useState('');
  const [description, setDescription] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('15');
  const [maxMembers, setMaxMembers] = useState('40');
  const [isOpen, setIsOpen] = useState(false);
  const [contactPhone, setContactPhone] = useState('');
  const [preferredDays, setPreferredDays] = useState<WeekdayIndex[]>([]);
  const [preferredHour, setPreferredHour] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Resetting the dependent street whenever the city text changes prevents
  // a stale street from one city sticking around when the user picks
  // another city.
  const handleCityChange = (next: string) => {
    setCity(next);
    if (street.length > 0) setStreet('');
  };
  const fetchCities = useCallback((q: string) => searchCities(q), []);
  const fetchStreets = useCallback(
    (q: string) => searchStreets(city, q),
    [city]
  );

  const toggleDay = (d: WeekdayIndex) => {
    setPreferredDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  };

  const phoneValid = isValidIsraeliPhone(contactPhone);
  const phoneEntered = contactPhone.trim().length > 0;
  const phoneError = phoneEntered && !phoneValid;

  const canSave =
    !!name.trim() && !!fieldName.trim() && !!user && phoneValid && !busy;

  const submit = async () => {
    if (!user || !canSave) return;
    setBusy(true);
    try {
      const parsedMax = parseInt(maxPlayers, 10);
      const parsedMaxMembers = parseInt(maxMembers, 10);
      const cityVal = city.trim();
      const streetVal = street.trim();
      const note = addressNote.trim();
      const phone = contactPhone.trim();
      const composedAddress =
        [streetVal, cityVal].filter(Boolean).join(', ') +
        (note ? ` — ${note}` : '');
      const group = await createGroup({
        name: name.trim(),
        fieldName: fieldName.trim(),
        fieldAddress: composedAddress.length > 0 ? composedAddress : undefined,
        city: cityVal || undefined,
        street: streetVal || undefined,
        addressNote: note || undefined,
        description: description.trim() || undefined,
        defaultMaxPlayers: Number.isFinite(parsedMax) ? parsedMax : 15,
        maxMembers: Number.isFinite(parsedMaxMembers) ? parsedMaxMembers : undefined,
        isOpen,
        contactPhone: phone,
        preferredDays: preferredDays.length > 0 ? preferredDays : undefined,
        preferredHour: preferredHour.trim() || undefined,
        notes: notes.trim() || undefined,
        creator: user,
      });
      logEvent(AnalyticsEvent.GroupCreated, { groupId: group.id });
      nav.replace('CommunityDetails', { groupId: group.id });
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const cityChosen = city.trim().length > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.createGroupTitle} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Field
          label={he.groupCreateName}
          value={name}
          onChange={setName}
          placeholder="חמישי כדורגל"
          autoFocus
        />
        <AutocompleteInput
          label={he.createGroupCity}
          value={city}
          onChange={handleCityChange}
          onSelect={(v) => {
            setCity(v);
            if (street.length > 0) setStreet('');
          }}
          placeholder={he.createGroupCityPlaceholder}
          fetchSuggestions={fetchCities}
        />
        <AutocompleteInput
          label={he.createGroupStreet}
          value={street}
          onChange={setStreet}
          onSelect={setStreet}
          placeholder={
            cityChosen
              ? he.createGroupStreetPlaceholder
              : he.createGroupStreetDisabledHint
          }
          disabled={!cityChosen}
          fetchSuggestions={fetchStreets}
        />
        <Field
          label={he.createGroupAddressNote}
          value={addressNote}
          onChange={setAddressNote}
          placeholder={he.createGroupAddressNotePlaceholder}
        />
        <Field
          label={he.groupCreateField}
          value={fieldName}
          onChange={setFieldName}
          placeholder="המגרש הקבוע"
        />
        <Field
          label={he.createGroupDescription}
          value={description}
          onChange={setDescription}
          placeholder="לא חובה"
          multiline
        />

        {/* Preferred days — multi-select pill row */}
        <View style={styles.field}>
          <Text style={styles.label}>{he.createGroupPreferredDays}</Text>
          <View style={styles.pillRow}>
            {ALL_DAYS.map((d) => {
              const active = preferredDays.includes(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDay(d)}
                  style={({ pressed }) => [
                    styles.dayPill,
                    active && styles.pillActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
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
          label={he.createGroupPreferredHour}
          value={preferredHour}
          onChange={setPreferredHour}
        />
        <Field
          label={he.createGroupMaxPlayers}
          value={maxPlayers}
          onChange={setMaxPlayers}
          keyboardType="number-pad"
        />
        <Field
          label={he.createGroupMaxMembers}
          value={maxMembers}
          onChange={setMaxMembers}
          keyboardType="number-pad"
        />
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{he.createGroupIsOpen}</Text>
            <Text style={styles.hint}>{he.createGroupIsOpenHint}</Text>
          </View>
          <Switch
            value={isOpen}
            onValueChange={setIsOpen}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
        <View>
          <Field
            label={he.createGroupContactPhone}
            value={contactPhone}
            onChange={setContactPhone}
            placeholder={he.createGroupContactPhonePlaceholder}
            keyboardType="phone-pad"
          />
          {phoneError ? (
            <Text style={styles.hintError}>
              {he.createGroupContactPhoneInvalid}
            </Text>
          ) : phoneEntered ? (
            <Text style={styles.hint}>{he.createGroupContactPhoneHint}</Text>
          ) : null}
        </View>
        <Field
          label={he.createGroupNotes}
          value={notes}
          onChange={setNotes}
          placeholder={he.createGroupNotesPlaceholder}
          multiline
        />
      </ScrollView>
      <View style={{ padding: spacing.lg }}>
        <Button
          title={he.createGroupSubmit}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSave}
          loading={busy}
          onPress={submit}
        />
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'phone-pad';
}) {
  return (
    <InputField
      label={label}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
      multiline={multiline}
      keyboardType={keyboardType}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  field: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textMuted },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  hintError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
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
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
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
  pillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  pillText: { ...typography.body, color: colors.textMuted },
});
