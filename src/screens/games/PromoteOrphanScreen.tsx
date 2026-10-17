// PromoteOrphanScreen — post-orphan-game "create a community from the
// people you just played with" flow. Reached two ways:
//
//   1. Tap on the `promotePrompt` push that fires ~30 minutes after
//      the orphan game finishes.
//   2. (Future) Inline CTA on the finished orphan game's details
//      screen.
//
// The screen takes the personal group id + the game id from route
// params, loads the participants, and lets the creator name the
// community + cherry-pick whom to invite. Submitting calls the
// `promoteOrphanToGroup` callable which un-hides the personal group,
// applies the new metadata, queues `groupInvitation` pushes to every
// invitee, and writes the /groupsPublic mirror.
//
// After success we navigate to the freshly-promoted CommunityDetails so
// the creator sees their new community right away.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeKeyboardAvoidingView as KeyboardAvoidingView } from '@/components/SafeKeyboardAvoidingView';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { ScrollSurface } from '@/components/ScrollSurface';
import { UserAvatar } from '@/components/UserAvatar';
import { FormDesignContext } from '@/components/forms/FormTheme';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { InputField } from '@/components/InputField';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { InfoTip } from '@/components/InfoTip';
import { RichRulesInput } from '@/components/community/RichRulesInput';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { searchCities } from '@/services/israelLocationService';
import { isValidIsraeliPhone } from '@/services/whatsappService';
import { groupService } from '@/services/groupService';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { Game, UserId } from '@/types';
import { useUserStore } from '@/store/userStore';
import { useGameStore } from '@/store/gameStore';
import { colors, spacing, typography, RTL_LABEL_ALIGN, shadows } from '@/theme';
import { he } from '@/i18n/he';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'PromoteOrphan'>;
type Params = RouteProp<GameStackParamList, 'PromoteOrphan'>;

export function PromoteOrphanScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Params>();
  const { groupId, gameId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const players = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [rules, setRules] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [city, setCity] = useState('');
  const [includedIds, setIncludedIds] = useState<Record<UserId, boolean>>({});

  // Phone is OPTIONAL here (the community chat covers contact now), but if
  // typed it must be a valid Israeli number.
  const phoneEntered = contactPhone.trim().length > 0;
  const phoneError = phoneEntered && !isValidIsraeliPhone(contactPhone);

  // Load the game once. It supplies the roster we'll let the user
  // cherry-pick from.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await gameService.getGameById(gameId);
        if (!alive) return;
        setGame(g);
        if (g) {
          const roster = Array.from(
            new Set([
              ...(g.players ?? []),
              ...(g.waitlist ?? []),
              ...(g.pending ?? []),
            ]),
          ).filter((uid) => uid !== me?.id);
          // Hydrate names for the checklist.
          if (roster.length > 0) hydratePlayers(roster);
          // Default: invite everyone who participated.
          const init: Record<UserId, boolean> = {};
          roster.forEach((uid) => (init[uid] = true));
          setIncludedIds(init);
        }
      } catch (err) {
        logError('promoteOrphanLoad', err, {
          screen: 'PromoteOrphanScreen',
          gameId,
          groupId,
        });
        if (__DEV__) console.warn('[promoteOrphan] load failed', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, hydratePlayers, me?.id]);

  const roster = useMemo<UserId[]>(() => {
    if (!game) return [];
    return Array.from(
      new Set([
        ...(game.players ?? []),
        ...(game.waitlist ?? []),
        ...(game.pending ?? []),
      ]),
    ).filter((uid) => uid !== me?.id);
  }, [game, me?.id]);

  const selectedCount = useMemo(
    () => roster.filter((uid) => includedIds[uid] === true).length,
    [roster, includedIds],
  );

  const togglePlayer = (uid: UserId) =>
    setIncludedIds((prev) => ({ ...prev, [uid]: !prev[uid] }));

  const submit = async () => {
    if (submitting) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      appAlert(he.promoteOrphanNameTooShortTitle, he.promoteOrphanNameTooShortBody);
      return;
    }
    if (phoneError) {
      appAlert(he.error, he.createGroupContactPhoneInvalid);
      return;
    }
    setSubmitting(true);
    try {
      const inviteUserIds = roster.filter((uid) => includedIds[uid] === true);
      const res = await groupService.promoteOrphanGroup({
        groupId,
        name: trimmedName,
        description: description.trim() || undefined,
        isOpen,
        rules: rules.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        city: city.trim() || undefined,
        inviteUserIds,
        fromGameId: gameId,
      });
      appAlert(
        he.promoteOrphanSuccessTitle,
        he.promoteOrphanSuccessBody(res.invited),
        [
          {
            text: he.promoteOrphanGoToCommunity,
            onPress: () => {
              (nav as { replace: (s: string, p: unknown) => void }).replace(
                'CommunityDetails',
                { groupId },
              );
            },
          },
        ],
      );
    } catch (err) {
      logError('promoteOrphanGroup', err, {
        screen: 'PromoteOrphanScreen',
        groupId,
        gameId,
        inviteCount: roster.filter((uid) => includedIds[uid] === true).length,
      });
      const e = err as { code?: string; message?: string };
      appAlert(
        he.promoteOrphanErrorTitle,
        e.message ?? he.promoteOrphanErrorBody,
      );
      if (__DEV__) console.warn('[promoteOrphan] submit failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.promoteOrphanTitle} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.promoteOrphanTitle} />
      {/* KAV so the autoFocused name field's keyboard doesn't hide the
          bottom-pinned submit button. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <FormDesignContext.Provider value={true}>
      <ScrollSurface contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.brand} accessible={false}>
          <Ionicons name="football-outline" size={27} color="#2861F4" />
          <Text style={styles.brandName}>Teamder</Text>
        </View>
        <View style={styles.hero}>
          <View style={styles.pitch} pointerEvents="none" accessible={false}>
            <Svg width={125} height={102} viewBox="0 0 140 110">
              <Rect x={4} y={4} width={132} height={102} fill="none" stroke="#D8E7FF" strokeWidth={1.5}/>
              <Line x1={70} y1={4} x2={70} y2={106} stroke="#D8E7FF"/>
              <Circle cx={70} cy={55} r={20} fill="none" stroke="#D8E7FF"/>
              <Rect x={4} y={33} width={20} height={44} fill="none" stroke="#D8E7FF"/>
              <Rect x={116} y={33} width={20} height={44} fill="none" stroke="#D8E7FF"/>
            </Svg>
          </View>
          <Image source={require('../../assets/images/form-toggle-football-3d.png')} style={styles.heroBall} resizeMode="contain" accessible={false}/>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>{'היה טוב?\nממשיכים יחד'}</Text>
            <Text style={styles.heroSubtitle}>הפכו את המחזור החד־פעמי למועדון קבוע והמשיכו לשחק יחד.</Text>
          </View>
        </View>

        {/* Same field set as the regular "create community" form, so a
            community made from a game is just as complete. All optional
            except the name. */}
        <View style={styles.fields}>
          <Text style={styles.cardTitle}>פרטי המועדון</Text>
          <InputField
            label={he.promoteOrphanNameLabel}
            value={name}
            onChangeText={(t) => setName(t.slice(0, 60))}
            placeholder={he.promoteOrphanNamePlaceholder}
            maxLength={60}
            required
          />
          <InputField
            label="תיאור קצר"
            value={description}
            onChangeText={setDescription}
            multiline
          />
          {/* Open vs admin-approved join. */}
          <Pressable
            accessible={false}
            onPress={() => setIsOpen((v) => !v)}
            style={styles.toggleCard}
          >
            <View style={styles.toggleText}>
              <View style={styles.toggleLabelRow}>
                <Ionicons name="people-outline" size={21} color="#16264B" />
                <Text style={styles.toggleLabel}>{he.createGroupIsOpen}</Text>
                <InfoTip title={he.createGroupIsOpen} text={he.createGroupIsOpenHint} />
              </View>
              <Text style={styles.toggleHint}>{isOpen ? 'כל שחקן יכול להצטרף למועדון' : 'הצטרפות באישור מנהל'}</Text>
            </View>
            <BallSwitch
              accessibilityLabel={he.createGroupIsOpen}
              value={isOpen}
              onValueChange={setIsOpen}
              trackColor={{ false: colors.border, true: '#3B82F6' }}
              thumbColor="#fff"
            />
          </Pressable>
        </View>
        <View style={styles.fields}>
          <Pressable onPress={()=>setDetailsExpanded(v=>!v)} accessibilityRole="button" accessibilityState={{expanded:detailsExpanded}} style={styles.detailsHeading}>
            <View style={styles.playerCopy}>
              <Text style={styles.detailsTitle}>עוד פרטים למועדון</Text>
              <Text style={styles.cardHint}>עיר, טלפון וחוקים — אפשר להשלים בהמשך</Text>
            </View>
            <Ionicons name={detailsExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#6682B3"/>
          </Pressable>
          {detailsExpanded ? <>
          <RichRulesInput
            label={he.communityDetailsRules}
            value={rules}
            onChangeText={setRules}
            placeholder={'לדוגמה:\n- מגיעים בזמן\n- **אסור** לעשן במגרש'}
          />
          <View>
            <InputField
              label={he.createGroupContactPhone}
              info={{ title: he.createGroupContactPhone, text: he.createGroupContactPhoneHint }}
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder={he.createGroupContactPhonePlaceholder}
              keyboardType="phone-pad"
            />
            {phoneError ? (
              <Text style={styles.hintError}>{he.createGroupContactPhoneInvalid}</Text>
            ) : null}
          </View>
          <AutocompleteInput
            label={he.promoteOrphanCityLabel}
            value={city}
            onChange={setCity}
            onSelect={setCity}
            placeholder={he.createGroupCityPlaceholder}
            fetchSuggestions={(q) => searchCities(q)}
          />
          </> : null}
        </View>

        <View style={styles.inviteCard}>
          <View style={styles.inviteHeading}>
            <Ionicons name="person-add-outline" size={24} color="#16264B" />
            <Text style={styles.cardTitle}>את מי מזמינים?</Text>
          </View>
          <Text style={styles.cardHint}>בחרו את השחקנים שתרצו להזמין למועדון</Text>
          <Text style={styles.selectedCount}>{selectedCount} מתוך {roster.length} נבחרו</Text>
        {roster.length === 0 ? (
          <Text style={styles.empty}>{he.promoteOrphanNoOthers}</Text>
        ) : (
          roster.map((uid) => {
            const player = players[uid];
            const checked = includedIds[uid] === true;
            return (
              <Pressable
                key={uid}
                onPress={() => togglePlayer(uid)}
                disabled={submitting}
                accessibilityRole="checkbox"
                accessibilityLabel={player?.displayName ?? 'שחקן מהמחזור'}
                accessibilityState={{checked, disabled: submitting}}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View
                  style={[
                    styles.checkbox,
                    checked && styles.checkboxOn,
                  ]}
                >
                  {checked ? (
                    <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                  ) : null}
                </View>
                <View style={styles.playerCopy}>
                  <Text style={styles.rowName} numberOfLines={2}>{player?.displayName ?? 'שחקן מהמחזור'}</Text>
                  <Text style={styles.playerHint}>{game?.players?.includes(uid) ? 'נרשם למחזור' : game?.waitlist?.includes(uid) ? 'ברשימת ההמתנה למחזור' : 'ביקש להצטרף למחזור'}</Text>
                </View>
                <UserAvatar size={43} user={{id:uid,name:player?.displayName ?? '',avatarId:player?.avatarId,photoUrl:player?.photoUrl ?? player?.avatarUrl}}/>
              </Pressable>
            );
          })
        )}
          <View style={styles.inviteNote}>
            <Ionicons name="information-circle-outline" size={22} color="#4366A1" />
            <Text style={styles.inviteNoteText}>תישלח הזמנה רק לשחקנים שבחרתם. הם יצטרפו למועדון לאחר שיאשרו אותה.</Text>
          </View>
        <Pressable
          onPress={submit}
          disabled={submitting || name.trim().length < 2}
          accessibilityRole="button"
          accessibilityState={{disabled:submitting || name.trim().length < 2, busy:submitting}}
          style={({ pressed }) => [
            styles.submit,
            (submitting || name.trim().length < 2) && { opacity: 0.5 },
            pressed && { opacity: 0.88 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.submitText}>{selectedCount ? 'צור מועדון ושלח הזמנות' : 'צור מועדון'}</Text>
              <Ionicons name={selectedCount ? 'paper-plane-outline' : 'add-circle-outline'} size={24} color="#FFFFFF" />
            </>
          )}
        </Pressable>
      </View>
      </ScrollSurface>
      </FormDesignContext.Provider>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F7FE' },
  scroll: {
    padding: 16,
    paddingBottom: 28,
    gap: 16,
  },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  brandName: { fontSize: 26, fontWeight: '900', color: '#10214A' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 20, minHeight: 170, backgroundColor: '#F8FBFF', borderRadius: 26, borderWidth: 1, borderColor: '#DBE9FC', overflow: 'hidden' },
  pitch: { position: 'absolute', end: -24, top: 14, opacity: 0.65, transform: [{rotate:'-12deg'}] },
  heroBall: { width: 62, height: 68 },
  heroCopy: { flex: 1 },
  heroTitle: { color: '#10214A', fontSize: 27, lineHeight: 35, fontWeight: '900', textAlign: RTL_LABEL_ALIGN },
  heroSubtitle: { color: '#7386A8', fontSize: 14, lineHeight: 21, marginTop: 6, textAlign: RTL_LABEL_ALIGN },
  cardTitle: { color: '#142449', fontSize: 21, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  cardHint: { color: '#7688A6', fontSize: 13, lineHeight: 20, textAlign: RTL_LABEL_ALIGN },
  inviteCard: { padding: 16, borderRadius: 25, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DFE9F8', ...shadows.card },
  inviteHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 5 },
  selectedCount: { color: '#2861F4', fontSize: 13, fontWeight: '700', marginTop: 10, marginBottom: 8, textAlign: RTL_LABEL_ALIGN },
  playerCopy: { flex: 1, gap: 3 },
  detailsHeading: {flexDirection:'row',alignItems:'center',gap:10},
  detailsTitle: {color:'#28436D',fontSize:16,fontWeight:'700',textAlign:RTL_LABEL_ALIGN},
  playerHint: { color: '#8491A8', fontSize: 12, textAlign: RTL_LABEL_ALIGN },
  toggleHint: { color: '#7587A5', fontSize: 12, lineHeight: 18, marginTop: 4, textAlign: RTL_LABEL_ALIGN },
  inviteNote: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, backgroundColor: '#EDF4FF', padding: 12, marginTop: 14, marginBottom: 14 },
  inviteNoteText: { flex: 1, color: '#4366A1', fontSize: 12, lineHeight: 19, textAlign: RTL_LABEL_ALIGN },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fields: { gap: 16, padding: 18, backgroundColor: '#FFFFFF', borderRadius: 25, borderWidth: 1, borderColor: '#DFE9F8', ...shadows.card },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#E2EBF8',
    paddingTop: 16,
    paddingBottom: 2,
    gap: spacing.md,
  },
  toggleText: { flexShrink: 1, alignItems: 'flex-start' },
  toggleLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  hintError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
    textAlign: RTL_LABEL_ALIGN,
  },
  empty: {
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderColor: '#E8EDF6',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: '#2861F4',
    borderColor: '#2861F4',
  },
  rowName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  submit: {
    backgroundColor: '#2861F4',
    paddingVertical: 16,
    paddingHorizontal: 10,
    minHeight: 56,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    alignItems: 'center',
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
