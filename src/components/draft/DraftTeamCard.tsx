// DraftTeamCard — full-width heading above a compact roster. The team label
// sits on the right; the captain (avatar ringed in brand blue, no "קפטן"
// text) starts the roster on the right; each drafted player is
// added beside the captain as a smaller avatar + two-line name, flowing
// leftward and wrapping as the team grows. Height is content-driven — no
// wasted space.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GrowIn, ShrinkOut } from './DraftScalePop';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, radius, spacing, typography, shadows, RTL_LABEL_ALIGN } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { teamName } from '@/utils/draft';
import { teamColor, teamTextColor, teamPaletteEntry } from '@/components/match/rotationView';
import { TeamShirtIllustration } from '@/components/match/TeamShirt';

export interface DraftUserLite {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
}

interface Props {
  /** Read-only team presentation in round details; the draft editor is unchanged. */
  summary?: boolean;
  completionCapacity?: number;
  index: number;
  captain: DraftUserLite;
  /** Drafted players (excludes the captain). */
  members: DraftUserLite[];
  /** Highlight the team whose turn it is to pick. */
  highlight?: boolean;
  /** Tap a player chip → open their card. */
  onPressUser?: (id: string) => void;
  /** Live board only: members grow in when drafted (off for static views). */
  growMembers?: boolean;
  /** A just-un-picked player still shrinking out of this card. */
  ghostMember?: DraftUserLite;
  /** Called when the ghost finishes shrinking, so the parent drops it. */
  onGhostDone?: () => void;
  /** Admin-chosen team colour key — names the team by colour ("האדומים"). */
  colorKey?: string;
  /** Tap the colour swatch to change it (admin only). */
  onPickColor?: () => void;
  /** Average internal rating of the team. Shown as a small ⭐ badge next to the
   *  team name ONLY when provided — the caller decides visibility (internal
   *  rating on, and either not hidden or the viewer is an admin). */
  teamRating?: number;
}

export function DraftTeamCard({
  index,
  captain,
  members,
  highlight,
  onPressUser,
  growMembers,
  ghostMember,
  onGhostDone,
  colorKey,
  onPickColor,
  teamRating,
  completionCapacity,
  summary = false,
}: Props) {
  // Each team carries its own colour. teamName/teamColor resolve the chosen
  // colour when there is one and the per-index default otherwise, so the branch
  // that used to live here is theirs.
  const asTeams = colorKey ? [{ index, colorKey }] : undefined;
  // Only needed for the swatch: a light bib needs dark contrast on top.
  const chosen = teamPaletteEntry(colorKey);
  const tColor = teamColor(index, asTeams);
  const tLabel = teamName(index, asTeams);
  if (summary) {
    const users = [captain,...members].filter(user=>!!user.id);
    const missing = Math.max(0,(completionCapacity ?? 0)-users.length);
    return <View style={styles.summaryCard}>
      <View style={[styles.summaryHeader,{backgroundColor:tColor+'0C'}]}>
        <TeamShirtIllustration color={tColor} width={28}/><Text style={[styles.summaryTitle,{color:teamTextColor(index,asTeams)}]}>{tLabel}</Text>
        {typeof teamRating==='number' && <View style={styles.ratingBadge} accessible accessibilityLabel={`ממוצע דירוג הקבוצה ${teamRating.toFixed(1)}`}><Text style={styles.ratingText}>{teamRating.toFixed(1)}</Text><Ionicons name="star" size={12} color={colors.primary}/></View>}
      </View>
      <View style={[styles.chips,styles.summaryRoster]}>{users.map(user=><Chip key={user.id} user={user} summary onPressUser={onPressUser}/>)}</View>
      {missing>0 && <Text style={styles.summaryMissing}>{`${users.length} מתוך ${completionCapacity} · השלמה לפני המשחק`}</Text>}
    </View>;
  }
  if (completionCapacity) {
    const users = [captain, ...members].filter(p => !!p.id);
    const missing = Math.max(0, completionCapacity - users.length);
    return <View style={{padding:14, borderRadius:22, borderWidth:1, borderColor:tColor+'45', backgroundColor:tColor+'0C', gap:12}}>
      <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
        <Pressable onPress={onPickColor} disabled={!onPickColor} accessibilityRole="button" accessibilityLabel="בחר צבע קבוצה"><Ionicons name="shirt" size={26} color={tColor}/></Pressable>
        <Text style={{flex:1,fontSize:18,fontWeight:'800',color:colors.text,textAlign:RTL_LABEL_ALIGN}}>{tLabel}</Text>
        <Text style={{fontSize:13,color:colors.textMuted}}>{`${users.length} מתוך ${completionCapacity}`}</Text>
      </View>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:7}}>
        {users.map(user => <Pressable key={user.id} disabled={!onPressUser} onPress={()=>onPressUser?.(user.id)} style={{width:'31%',minHeight:58,flexDirection:'row',alignItems:'center',gap:5,padding:7,borderRadius:15,backgroundColor:'#FFFFFF'}}>
          <UserAvatar user={user} size={26}/><Text numberOfLines={2} style={{flex:1,fontSize:12,color:colors.text,textAlign:RTL_LABEL_ALIGN}}>{user.name}</Text>
        </Pressable>)}
        {Array.from({length:missing},(_,i)=><View key={`fill-${i}`} style={{width:'31%',minHeight:58,borderRadius:15,borderWidth:1,borderStyle:'dashed',borderColor:colors.primary,alignItems:'center',justifyContent:'center',padding:5}}>
          <Ionicons name="add-circle-outline" size={20} color={colors.primary}/><Text style={{fontSize:11,color:colors.primary,textAlign:'center'}}>השלמה לפני המשחק</Text>
        </View>)}
      </View>
      {typeof teamRating === 'number' && <Text style={{fontSize:12,color:colors.textMuted,textAlign:RTL_LABEL_ALIGN}}>{`ממוצע קבוצת הבסיס: ${teamRating.toFixed(1)}`}</Text>}
    </View>;
  }
  return (
    <View
      style={[
        styles.card,
        { borderColor: tColor },
        highlight && styles.cardHighlight,
      ]}
    >
      {/* The heading has its own line so five 60-point chips fit a normal
          phone without the team name taking a sixth player's space. */}
      <View style={styles.teamNameRow}>
        {onPickColor ? (
          <Pressable
            onPress={onPickColor}
            hitSlop={8}
            style={[styles.colorSwatch, { backgroundColor: tColor, borderColor: chosen?.light ? colors.border : tColor }]}
            accessibilityRole="button"
            accessibilityLabel="בחר צבע קבוצה"
          >
            <Ionicons name="color-palette" size={12} color={chosen?.light ? colors.textMuted : '#FFFFFF'} />
          </Pressable>
        ) : (
          <View style={[styles.teamDot, { backgroundColor: tColor }]} />
        )}
        <Text style={[styles.teamName, { color: tColor }]}>{tLabel}</Text>
        {typeof teamRating === 'number' ? (
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={11} color={colors.primary} />
            <Text style={styles.ratingText}>{teamRating.toFixed(1)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.chips}>
        <Chip user={captain} captain onPressUser={onPressUser} />
        {members.map((m) =>
          growMembers ? (
            <GrowIn key={m.id}>
              <Chip user={m} onPressUser={onPressUser} />
            </GrowIn>
          ) : (
            <Chip key={m.id} user={m} onPressUser={onPressUser} />
          ),
        )}
        {ghostMember && onGhostDone ? (
          <ShrinkOut key={`ghost-${ghostMember.id}`} onDone={onGhostDone}>
            <Chip user={ghostMember} />
          </ShrinkOut>
        ) : null}
      </View>
    </View>
  );
}

function Chip({
  user,
  captain,
  onPressUser,
  summary,
}: {
  user: DraftUserLite;
  captain?: boolean;
  onPressUser?: (id: string) => void;
  summary?: boolean;
}) {
  const body = (
    <>
      {/* Fixed-height area so a smaller member avatar centers on the same
          line as the larger captain avatar (not pinned to the top). */}
      <View style={styles.avatarArea}>
        <View style={captain ? styles.captainRing : undefined}>
          <UserAvatar user={user} size={summary ? 40 : captain ? 34 : 30} />
        </View>
      </View>
      <Text style={[styles.chipName,summary && styles.summaryName]} numberOfLines={2} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale={0.85}>
        {(user.name ?? '').trim()}
      </Text>
    </>
  );
  return onPressUser ? (
    <Pressable
      style={[styles.chip,summary && styles.summaryChip]}
      onPress={() => onPressUser(user.id)}
      accessibilityRole="button"
      accessibilityLabel={user.name}
    >
      {body}
    </Pressable>
  ) : (
    <View style={[styles.chip,summary && styles.summaryChip]}>{body}</View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {backgroundColor:colors.surface,borderRadius:18,borderWidth:1,borderColor:colors.border,overflow:'hidden',...shadows.card},
  summaryHeader: {flexDirection:'row',alignItems:'center',gap:7,paddingVertical:5,paddingHorizontal:12},
  summaryTitle: {flex:1,minWidth:0,fontSize:17,fontWeight:'800',textAlign:RTL_LABEL_ALIGN},
  summaryRoster: {columnGap:0,rowGap:6,paddingTop:6,paddingBottom:3,paddingHorizontal:4},
  summaryChip: {width:'20%',paddingHorizontal:2},
  summaryName: {fontSize:12,lineHeight:16,minHeight:32},
  summaryMissing: {fontSize:12,color:colors.textMuted,textAlign:RTL_LABEL_ALIGN,paddingHorizontal:12,paddingBottom:10},
  card: {
    alignSelf: 'stretch',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  cardHighlight: { borderColor: colors.primary, borderWidth: 2 },
  teamNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  teamDot: { width: 8, height: 8, borderRadius: 4 },
  colorSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamName: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primary,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  ratingText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    columnGap: 4,
    rowGap: spacing.xs,
    alignSelf: 'stretch',
  },
  chip: { width: 60, alignItems: 'center', gap: 3 },
  avatarArea: { height: 44, justifyContent: 'center', alignItems: 'center' },
  captainRing: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 99,
    padding: 1.5,
  },
  chipName: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 15,
    minHeight: 30,
    width: '100%',
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
});
