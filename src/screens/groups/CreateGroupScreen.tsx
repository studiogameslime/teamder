// 2-step wizard for creating a new community.
//
// Step 1 (פרטים)   — required basics: name, fieldName + location autocomplete.
// Step 2 (מתקדם) — optional defaults: description, preferred schedule,
//                  contact phone, member caps, open-join toggle, cost,
//                  free-text notes. Anything left empty falls back to a
//                  sensible default in createGroup.
//
// Mirrors GameWizardForm's structure: shared StepIndicator with soccer-
// ball glyphs, same fade-on-step-change animation, fixed-bottom footer
// with back / next / submit. Lives in a single file (no shared form
// component) because CommunityEditScreen has its own bespoke layout.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
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
import { StepIndicator } from '@/components/StepIndicator';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import {
  searchCities,
  searchStreets,
} from '@/services/israelLocationService';
import { isValidIsraeliPhone } from '@/services/whatsappService';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';

export function CreateGroupScreen() {
  const nav = useNavigation<
    NativeStackNavigationProp<CommunitiesStackParamList, 'CommunitiesCreate'>
  >();
  const user = useUserStore((s) => s.currentUser);
  const createGroup = useGroupStore((s) => s.createGroup);

  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);

  // Step-1 fields.
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');

  // Step-2 fields.
  const [addressNote, setAddressNote] = useState('');
  const [description, setDescription] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('15');
  const [maxMembers, setMaxMembers] = useState('40');
  const [isOpen, setIsOpen] = useState(false);

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

  // Phone is optional but if entered must be a valid IL mobile.
  const phoneEntered = contactPhone.trim().length > 0;
  const phoneValid = !phoneEntered || isValidIsraeliPhone(contactPhone);
  const phoneError = phoneEntered && !isValidIsraeliPhone(contactPhone);

  // Step-1 gate: name is the bare minimum to make a usable community.
  // Everything else (city/street + step-2 details) is optional.
  const step1Valid = name.trim().length > 0;
  const canSave = step1Valid && !!user && phoneValid && !busy;

  // Subtle fade-in when transitioning between steps.
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [step, fade]);

  const goNext = () => {
    if (step === 1 && !step1Valid) return;
    if (step < 2) setStep(2);
  };
  const goBack = () => {
    if (step > 1) setStep(1);
  };

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
        // The wizard no longer asks for a separate "שם המגרש" — the
        // address line above is enough. Existing screens fall back to
        // city/fieldAddress when this is empty.
        fieldName: '',
        fieldAddress: composedAddress.length > 0 ? composedAddress : undefined,
        city: cityVal || undefined,
        street: streetVal || undefined,
        addressNote: note || undefined,
        description: description.trim() || undefined,
        defaultMaxPlayers: Number.isFinite(parsedMax) ? parsedMax : 15,
        maxMembers: Number.isFinite(parsedMaxMembers)
          ? parsedMaxMembers
          : undefined,
        isOpen,
        contactPhone: phone || undefined,
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
        {/* Pinned step indicator — same pattern as GameWizardForm.
            Stays visible while the user scrolls the form. */}
        <View style={styles.stickyHeader}>
          <StepIndicator
            current={step}
            labels={[he.wizardStep1, he.groupWizardStep2]}
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.body, { opacity: fade }]}>
            {step === 1 ? (
              <View style={styles.stack}>
                <InputField
                  label={he.groupCreateName}
                  value={name}
                  onChangeText={setName}
                  placeholder="לדוגמה: חמישי כדורגל"
                  autoFocus
                  required
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

                {/* Open-join is the most consequential setting at
                    creation time (decides whether new players need
                    admin approval), so it lives in step 1 right after
                    the location identity. */}
                <Pressable
                  onPress={() => setIsOpen(!isOpen)}
                  style={styles.toggleRow}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>
                      {he.createGroupIsOpen}
                    </Text>
                    <Text style={styles.hint}>{he.createGroupIsOpenHint}</Text>
                  </View>
                  <Switch
                    value={isOpen}
                    onValueChange={setIsOpen}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </Pressable>
              </View>
            ) : null}

            {step === 2 ? (
              <View style={styles.stack}>
                <InputField
                  label={he.createGroupAddressNote}
                  value={addressNote}
                  onChangeText={setAddressNote}
                  placeholder={he.createGroupAddressNotePlaceholder}
                />
                <InputField
                  label={he.createGroupDescription}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                />

                <View>
                  <InputField
                    label={he.createGroupContactPhone}
                    value={contactPhone}
                    onChangeText={setContactPhone}
                    placeholder={he.createGroupContactPhonePlaceholder}
                    keyboardType="phone-pad"
                  />
                  {phoneError ? (
                    <Text style={styles.hintError}>
                      {he.createGroupContactPhoneInvalid}
                    </Text>
                  ) : phoneEntered ? (
                    <Text style={styles.hint}>
                      {he.createGroupContactPhoneHint}
                    </Text>
                  ) : null}
                </View>

                {/* Player + member caps share a row — they're related
                    counts users tend to set together. */}
                <View style={styles.numberRow}>
                  <View style={styles.numberCell}>
                    <InputField
                      label={he.createGroupMaxPlayers}
                      value={maxPlayers}
                      onChangeText={setMaxPlayers}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={styles.numberCell}>
                    <InputField
                      label={he.createGroupMaxMembers}
                      value={maxMembers}
                      onChangeText={setMaxMembers}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
              </View>
            ) : null}
          </Animated.View>
        </ScrollView>

        <View style={styles.footer}>
          {step > 1 ? (
            <Button
              title={he.wizardStepBack}
              variant="outline"
              size="lg"
              onPress={goBack}
              disabled={busy}
            />
          ) : null}
          <View style={{ flex: 1 }}>
            {step < 2 ? (
              <Button
                title={he.wizardStepNext}
                variant="primary"
                size="lg"
                fullWidth
                onPress={goNext}
                disabled={busy || !step1Valid}
              />
            ) : (
              <Button
                title={he.createGroupSubmit}
                variant="primary"
                size="lg"
                fullWidth
                onPress={submit}
                loading={busy}
                disabled={!canSave}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing.xl },
  stickyHeader: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  body: { padding: spacing.lg, gap: spacing.md },
  stack: { gap: spacing.md },
  section: { gap: spacing.xs, alignItems: 'stretch' },
  label: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },
  hintError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  numberRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  numberCell: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.bg,
    alignItems: 'center',
  },
});
