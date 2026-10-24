import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { TeamShirtIllustration } from '@/components/match/TeamShirt';
import { TEAM_PALETTE, teamPaletteEntry, teamLetter, type TeamLike } from '@/utils/teamIdentity';
import { RTL_LABEL_ALIGN } from '@/theme';
import { overlaySurfaces, overlayTheme } from '@/theme/overlays';
import { toast } from '@/components/Toast';
import { observeCaughtError } from '@/utils/errorObservation';

type ColorTeam = TeamLike & {index: number; colorKey: string};
export function TeamColorTiles({teams, onEdit, labels = false}: {teams: ColorTeam[]; onEdit?: (index: number) => void; labels?: boolean}) {
  return <View style={s.tiles}>{teams.map(t => {
    const color = teamPaletteEntry(t.colorKey)!;
    return <View key={t.index} style={[s.tile, {backgroundColor: color.hex+'0D', borderColor: color.hex+'20'}]}>
      <TeamShirtIllustration color={color.hex}/>
      {labels && <Text style={s.small}>{`קבוצה ${teamLetter(t.index)}׳`}</Text>}
      <Text style={s.name}>{color.plural}</Text>
      {onEdit && <TeamColorButton index={t.index} onPress={() => onEdit(t.index)}/>}
    </View>;
  })}</View>;
}

export function TeamColorButton({index, onPress, disabled}: {index: number; onPress: () => void; disabled?: boolean}) {
  return <Pressable disabled={disabled} onPress={onPress} style={s.edit} accessibilityRole="button"
    accessibilityLabel={`שינוי צבע של קבוצה ${teamLetter(index)}׳`} accessibilityState={{disabled: !!disabled}}>
    <Ionicons name="pencil-outline" size={14} color="#2563EB"/><Text style={s.link}>שינוי צבע</Text>
  </Pressable>;
}

export function TeamColorPicker({teamIndex, teams, onSave, onClose}: {
  teamIndex: number | null; teams: ColorTeam[]; onSave: (colors: Record<number, string>) => Promise<void>; onClose: () => void;
}) {
  const {height} = useWindowDimensions();
  const [chosen, setChosen] = useState('');
  const [exchange, setExchange] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const source = JSON.stringify(teams);
  useEffect(() => {setChosen(teams.find(t => t.index === teamIndex)?.colorKey ?? ''); setExchange(null);}, [teamIndex, source]);
  const current = teams.find(t => t.index === teamIndex);
  const next = teamPaletteEntry(chosen);
  const close = () => {if (!busy) onClose();};
  const save = async () => {
    if (!current || busy || !next || chosen === current.colorKey) return;
    const colors = Object.fromEntries(teams.map(t => [t.index, t.colorKey]));
    colors[current.index] = chosen;
    if (exchange !== null) colors[exchange] = current.colorKey;
    setBusy(true);
    try {await onSave(colors); onClose();}
    catch (error) {
      observeCaughtError(error, {source:'src/components/draft/TeamColorEditor.tsx', handler:'save', site:'TeamColorPicker:save'});
      toast.error(error instanceof Error && error.message === 'DRAFT_COLORS_CHANGED' ? 'הצבעים השתנו במכשיר אחר. חזרו למסך הכוחות וטענו אותו מחדש.' : error instanceof Error && error.message === 'DRAFT_COLORS_LOCKED' ? 'המחזור כבר נכנס ללייב. אי אפשר לערוך כאן את הצבעים.' : 'לא הצלחנו לשמור את הצבעים. נסו שוב.');
    } finally {setBusy(false);}
  };
  const transition = (index: number, from: string, to: string) => <View style={s.transition} key={index}>
    <Text style={s.name}>{`קבוצה ${teamLetter(index)}׳`}</Text><View style={s.transitionRow}>
      <View style={s.identity}><TeamShirtIllustration color={teamPaletteEntry(from)!.hex} width={42}/><Text style={s.name}>{teamPaletteEntry(from)!.plural}</Text><Text style={s.small}>כעת</Text></View>
      <Ionicons name="arrow-back" size={20} color="#61728D"/>
      <View style={s.identity}><TeamShirtIllustration color={teamPaletteEntry(to)!.hex} width={42}/><Text style={s.name}>{teamPaletteEntry(to)!.plural}</Text><Text style={s.small}>לאחר ההחלפה</Text></View>
    </View>
  </View>;
  return <SafeModal visible={!!current} transparent animationType="fade" onRequestClose={close}>
    <View style={s.backdrop}><Pressable style={StyleSheet.absoluteFill} onPress={close} disabled={busy} accessibilityLabel="ביטול בחירת צבע" accessibilityRole="button"/>
      <View style={[s.sheet, {maxHeight: height * 0.9}]}>
        <View style={s.heading}><Text style={s.title}>{exchange !== null ? 'להחליף בין הצבעים?' : `צבע לקבוצה ${teamLetter(teamIndex ?? 0)}׳`}</Text><Pressable onPress={close} disabled={busy} style={s.close} accessibilityRole="button" accessibilityLabel="סגירה"><Ionicons name="close" size={23} color="#12234D"/></Pressable></View>
        <ScrollView style={{flexShrink:1}} contentContainerStyle={s.content}>
          {current && next && (exchange !== null ? <>
            <Text style={s.small}>{`${next.plural} כבר בשימוש בקבוצה ${teamLetter(exchange)}׳`}</Text>
            {transition(current.index, current.colorKey, chosen)}{transition(exchange, chosen, current.colorKey)}
            <Text style={s.small}>שתי הקבוצות יחליפו צבעים ושמות. השחקנים וסדר הבחירה יישארו כפי שהגדרתם.</Text>
          </> : <>
            <View style={s.preview}><TeamShirtIllustration color={next.hex} width={54}/><View style={s.flex}><Text style={s.name}>{next.plural}</Text><Text style={s.small}>{chosen === current.colorKey ? 'הצבע הנוכחי' : `במקום ${teamPaletteEntry(current.colorKey)!.plural}`}</Text></View></View>
            <View style={s.palette}>{TEAM_PALETTE.map(c => {
              const other = teams.find(t => t.index !== current.index && t.colorKey === c.key);
              const checked = chosen === c.key;
              return <Pressable key={c.key} disabled={busy} onPress={() => {setChosen(c.key); setExchange(other?.index ?? null);}} style={[s.swatch, checked && s.selected]} accessibilityRole="radio" accessibilityLabel={`${c.plural}${other ? `, של קבוצה ${teamLetter(other.index)}׳, החלפת צבעים` : ''}`} accessibilityState={{checked, disabled: busy}}>
                <TeamShirtIllustration color={c.hex} width={34}/><Text style={s.colorName}>{c.plural}</Text><Text style={s.colorStatus}>{current.colorKey === c.key ? 'נוכחי' : other ? `של קבוצה ${teamLetter(other.index)}׳` : 'פנוי'}</Text>
              </Pressable>;
            })}</View><Text style={s.small}>צבע שכבר בשימוש? נבקש אישור להחלפה בין הקבוצות.</Text>
          </>)}
        </ScrollView>
        <Pressable disabled={busy || !current || chosen === current.colorKey} onPress={save} style={[s.primary, (busy || chosen === current?.colorKey) && s.disabled]} accessibilityRole="button" accessibilityState={{disabled: busy || !current || chosen === current.colorKey}}>{busy ? <ActivityIndicator color="#FFF"/> : <Text style={s.primaryText}>{exchange !== null ? 'אישור החלפה' : 'אישור הצבע'}</Text>}</Pressable>
        <Pressable disabled={busy} onPress={exchange !== null ? () => {setExchange(null); setChosen(current?.colorKey ?? '');} : close} style={s.edit} accessibilityRole="button"><Text style={s.link}>{exchange !== null ? 'חזרה לבחירת צבע' : 'ביטול'}</Text></Pressable>
      </View>
    </View>
  </SafeModal>;
}

const s = StyleSheet.create({
  tiles:{flexDirection:'row',flexWrap:'wrap',gap:9}, tile:{width:'31%',flexGrow:1,maxWidth:'49%',alignItems:'center',paddingVertical:12,paddingHorizontal:3,borderRadius:17,borderWidth:1,gap:5},
  name:{fontSize:16,fontWeight:'800',color:'#12234D',textAlign:RTL_LABEL_ALIGN}, small:{fontSize:12,lineHeight:19,color:'#61728D',textAlign:RTL_LABEL_ALIGN},
  edit:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4,minHeight:44,paddingHorizontal:3},link:{fontSize:12,fontWeight:'700',color:'#2563EB'},
  backdrop:{flex:1,justifyContent:'flex-end',backgroundColor:overlayTheme.backdrop},sheet:{...overlaySurfaces.sheet,padding:16,gap:10},
  heading:{flexDirection:'row',alignItems:'center',gap:8},title:{flex:1,fontSize:21,fontWeight:'800',color:'#12234D',textAlign:RTL_LABEL_ALIGN},close:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  content:{gap:12,paddingBottom:8},preview:{flexDirection:'row',alignItems:'center',gap:16,padding:14,borderRadius:18,backgroundColor:'#F3F7FF'},flex:{flex:1},
  palette:{flexDirection:'row',flexWrap:'wrap',gap:6},swatch:{width:'23%',flexGrow:1,alignItems:'center',paddingVertical:9,gap:5,borderRadius:14,borderWidth:1,borderColor:'#E2E8F0',minHeight:102},selected:{borderColor:'#2563EB',backgroundColor:'#EFF6FF'},colorName:{fontSize:12,color:'#12234D'},colorStatus:{fontSize:10,color:'#61728D'},
  transition:{padding:13,borderRadius:18,backgroundColor:'#F3F7FF',gap:12},transitionRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-around',gap:8},identity:{flex:1,alignItems:'center',gap:5},
  primary:{minHeight:52,alignItems:'center',justifyContent:'center',backgroundColor:'#2563EB',borderRadius:16,padding:10},primaryText:{color:'#FFF',fontSize:17,fontWeight:'800'},disabled:{opacity:0.5},
});
