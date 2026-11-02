import { observeCaughtError } from '../../utils/errorObservation';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SocialAction, SocialTitle, socialStyles as s } from '@/components/social/SocialUI';
import { useUserStore } from '@/store/userStore';
import { socialPlayersService } from '@/services/socialPlayersService';
import { dmRequestService } from '@/services/dmRequestService';
import type { StatisticsVisibility } from '@/types/social';
import { toast } from '@/components/Toast';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { FormDesignContext } from '@/components/forms/FormTheme';

export function SocialPrivacyScreen() {
  const me = useUserStore(x => x.currentUser);
  const [discoverable, setDiscoverable] = useState(me?.socialPrivacy?.discoverable !== false);
  const [statistics, setStatistics] = useState<StatisticsVisibility>(me?.socialPrivacy?.statistics ?? 'friends');
  const [busy, setBusy] = useState(false);
  const [dmPolicy,setDmPolicy]=useState<'everyone'|'friends'|undefined>(me?.dmRequestPolicy);
  useEffect(()=>setDmPolicy(me?.dmRequestPolicy),[me?.id,me?.dmRequestPolicy]);
  const saveDm=async()=>{
    if(!me||me.isGuest||busy||!dmPolicy)return;
    setBusy(true);
    try{await dmRequestService.savePrivacy(me.id,dmPolicy);toast.success('העדפת בקשות השיחה נשמרה');}
    catch (caughtError183eba2a66){
    observeCaughtError(caughtError183eba2a66, {"source":"src/screens/profile/SocialPrivacyScreen.tsx","handler":"saveDm","site":"SocialPrivacyScreen:183eba2a66"});toast.error('לא ניתן לשמור כרגע. נסו שוב');}
    finally{setBusy(false);}
  };
  useEffect(()=>{setDiscoverable(me?.socialPrivacy?.discoverable!==false);setStatistics(me?.socialPrivacy?.statistics??'friends');},[me?.id]);
  const save = async () => {
    if (busy || !me || me.isGuest) return;
    setBusy(true);
    try { await socialPlayersService.savePrivacy({discoverable,statistics},me.id); toast.success('הגדרות הפרטיות נשמרו'); }
    catch (caughtErrore2dac7046d) {
    observeCaughtError(caughtErrore2dac7046d, {"source":"src/screens/profile/SocialPrivacyScreen.tsx","handler":"save","site":"SocialPrivacyScreen:e2dac7046d"}); toast.error('לא ניתן לשמור כרגע. נסה שוב'); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={s.root} edges={['top']}><ScreenHeader title="פרטיות השחקן" />
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.card}><SocialTitle title="מי יכול לשלוח לי בקשות לשיחה?" icon="chatbubbles-outline"/>
        {!me?.dmRequestPolicy?<Text style={s.body}>צריך לבחור פעם אחת. עד שתשמרו בחירה, לא יתקבלו בקשות חדשות. השיחות הקיימות נשמרות.</Text>:null}
        {([['everyone','כולם'],['friends','חברים בלבד']] as const).map(([value,label])=><SocialAction key={value} title={label} icon={dmPolicy===value?'checkmark-circle':'ellipse-outline'} secondary={dmPolicy!==value} disabled={busy} onPress={()=>setDmPolicy(value)}/>)}
        <Text style={s.body}>שיחות שכבר אושרו ובקשות שכבר התקבלו נשארות זמינות גם אחרי מעבר לחברים בלבד.</Text>
        <SocialAction title="שמור בחירת הודעות" icon="checkmark-outline" disabled={busy||!dmPolicy||!me||me.isGuest} onPress={()=>void saveDm()}/>
      </View>
      <View style={s.card}><SocialTitle title="מציאת שחקנים" icon="search-outline" />
        <View style={s.row}><Text style={[s.body,{flex:1,color:'#0C1744'}]}>אפשר למצוא אותי בחיפוש שחקנים</Text><FormDesignContext.Provider value={true}><BallSwitch value={discoverable} onValueChange={setDiscoverable} disabled={busy} accessibilityLabel="אפשר למצוא אותי בחיפוש שחקנים" /></FormDesignContext.Provider></View>
        <Text style={s.body}>גם כשהאפשרות כבויה, תמשיך להופיע במועדונים ובמחזורים שבהם אתה משתתף.</Text>
      </View>
      <View style={s.card}><SocialTitle title="מי רואה את הסטטיסטיקה שלי?" icon="stats-chart-outline" />
        <View style={{gap:10}}>{([['everyone','כולם'],['friends','חברים בלבד'],['onlyMe','רק אני']] as const).map(([value,label])=><SocialAction key={value} title={label} icon={statistics===value?'checkmark-circle':'ellipse-outline'} secondary={statistics!==value} disabled={busy} onPress={()=>setStatistics(value)} />)}</View>
        <Text style={[s.body,{marginTop:12}]}>הבחירה חלה על התקציר בפרופיל ועל הסטטיסטיקה המלאה.</Text>
      </View>
      <View style={s.card}><SocialTitle title="מה גלוי לשחקנים אחרים?" icon="eye-outline" /><Text style={s.body}>השם, התמונה, העיר, המועדונים והזמינות שסימנת גלויים לשחקנים רשומים. בקשת שיחה מאפשרת להתכתב בלי להוסיף חברות, בהתאם לבחירת קבלת הבקשות.</Text></View>
      <SocialAction title={busy?'שומר…':'שמור הגדרות'} icon="checkmark-outline" disabled={busy || !me || me.isGuest} onPress={()=>void save()} />
    </ScrollView>
  </SafeAreaView>;
}
