import { observeCaughtError } from '../services/errorObservation';
import { PlayerHistory } from '../components/PlayerHistory';
import { PlayerDisclosure as Disclosure } from '../components/PlayerDisclosure';
import { PlayerOverview, PlayerClubs, PlayerRounds } from '../components/PlayerOverview';
import { playerSummary } from '../services/playerSummary';
import { UserProfileInformation, UserRelationships, UserRelatedRecords, PublicInformation, RecordFields } from '../components/UserInformation';
import { UserDevicesCard } from '../components/DeviceVersions';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TeamderChatSheet } from '../components/TeamderChatSheet';
import { isolateText, RTL_LABEL_ALIGN, RTL_VALUE_ALIGN, colors, font, radius  } from '../theme';
import { Card, SectionHeader, Panel } from '../components/ui';
import { useDashboard } from '../state/DashboardContext';
import { fetchUserActivity, setUserQa } from '../services/firebase';
import { timeAgo } from '../format';
import type { UserActivity } from '../types';
import type { UsersStackParams } from '../navigation/UsersStack';

// Bug-status pill on the user card — resolved/in-review bugs stay visible
// (instead of vanishing) with a clear label.
const BUG_STATUS: Record<'new' | 'reviewed' | 'resolved', { label: string; color: string }> = {
  new: { label: 'פתוח', color: colors.red },
  reviewed: { label: 'בבדיקה', color: colors.amber },
  resolved: { label: 'תוקן ✓', color: colors.green },
};

export function UserDetailScreen() {
  const route = useRoute<RouteProp<UsersStackParams, 'UserDetail'>>();
  const nav = useNavigation();
  const { snapshot } = useDashboard();
  const { userId } = route.params;
  const [data, setData] = useState<UserActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [qa, setQa] = useState(false);
  const [qaSaving, setQaSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [section, setSection] = useState('overview');
  const scrollRef=useRef<ScrollView>(null);
  const clubsRef=useRef<View>(null);
  const [focusClubs,setFocusClubs]=useState(false);
  useEffect(()=>{
    if(section!=='info' || !focusClubs) return;
    const frame=requestAnimationFrame(()=>{
      const container=scrollRef.current?.getInnerViewNode();
      if(!container || !clubsRef.current) return;
      clubsRef.current.measureLayout(container,(_x,y)=>{scrollRef.current?.scrollTo({y,animated:true});setFocusClubs(false)},()=>setFocusClubs(false));
    });
    return ()=>cancelAnimationFrame(frame);
  },[section,focusClubs]);

  // The user's personal invite link — registrations + clicks through it are
  // attributed to them (matches deepLinkService.buildAppInviteUrl on the app).
  const inviteLink = `https://teamderfc.web.app/app?invitedBy=${userId}`;
  const copyInviteLink = async () => {
    await Clipboard.setStringAsync(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true); setLoadFailed(false); setData(null);
        const a = await fetchUserActivity(userId, retry > 0);
        if (alive) setData(a);
      } catch (caughtErrorb854a07bc8) {
    observeCaughtError(caughtErrorb854a07bc8, {"source":"pulse/src/screens/UserDetailScreen.tsx","handler":"UserDetailScreen","site":"UserDetailScreen:b854a07bc8"});
        if (alive) setLoadFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId, retry]);


  const u = data?.user ?? snapshot.users.find((x) => x.id === userId);

  // Seed the QA toggle from the (possibly stale) cached user...
  useEffect(() => {
    if (u) setQa(u.qa === true);
  }, [u?.id, u?.qa]);

  // Always return to the users LIST, never to whatever tab happens to be
  // "first" in the tab navigator's back-behavior. goBack() from a hidden
  // tab's stack can fall through to Home; navigating to the named route
  // pops straight to the list (and works even if the detail was the only
  // screen restored on the stack).
  const goBackToList = () => {
    (nav as any).navigate('UsersList');
  };

  const toggleQa = async () => {
    if (!u || qaSaving) return;
    const next = !qa;
    setQa(next); // optimistic
    setQaSaving(true);
    const ok = await setUserQa(u.id, next);
    if (!ok) setQa(!next); // revert on failure
    setQaSaving(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={goBackToList} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-forward" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          פרטי שחקן
        </Text>
        <View style={{width:26}}/>
      </View>

      <TeamderChatSheet
        visible={messaging}
        userId={userId}
        userName={u?.name ?? ''}
        onClose={() => setMessaging(false)}
      />

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => setRetry(n=>n+1)} tintColor={colors.primary}/>}
      >
        {u ? (
          <View style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:10,paddingVertical:8}}>
            <View style={{width:48,height:48,borderRadius:24,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center'}}><Text style={{color:colors.onPrimary,fontSize:22,fontWeight:'700'}}>{u.name.split(/\s+/).slice(0,2).map(part=>part[0]).join('')}</Text></View>
            <View style={{flex:1,minWidth:0,gap:4}}><Text style={{ ...font.h2,fontSize:20,textAlign: RTL_LABEL_ALIGN}}>{isolateText(u.name)}</Text><Text style={{ ...font.small,fontSize:12,textAlign: RTL_LABEL_ALIGN}}>{u.city || 'עיר לא תועדה'} · {typeof data?.record?.lastSeenAt==='number'?`פעיל ${timeAgo(data.record.lastSeenAt)}`:'פעילות אחרונה לא תועדה'}</Text></View>
            <Pressable accessibilityRole="button" onPress={()=>setMessaging(true)} style={{backgroundColor:'transparent',borderWidth:1,borderColor:colors.primary,borderRadius:10,paddingHorizontal:12,minHeight:40,flexDirection:'row',direction:'rtl',alignItems:'center',justifyContent:'center',gap:6}}><Ionicons name="chatbubble-outline" size={20} color={colors.primary}/><Text style={{...font.body,color:colors.primary}}>שיחה</Text></Pressable>
          </View>
        ) : null}

        <View accessibilityRole="tablist" style={styles.tabs}>{[{key:'overview',label:'סקירה'},{key:'info',label:'מידע'},{key:'history',label:'היסטוריה'}].map(tab=><Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{selected:section===tab.key}} onPress={()=>setSection(tab.key)} style={[styles.tab,section===tab.key && {borderBottomColor:colors.primary}]}><Text style={{...font.title,color:section===tab.key?colors.primary:colors.textMuted}}>{tab.label}</Text></Pressable>)}</View>
        {loading ? <ActivityIndicator color={colors.primary}/> : null}
        {loadFailed ? <Pressable onPress={()=>setRetry(n=>n+1)}><Text style={{...font.body,color:colors.amber}}>טעינת המשתמש נכשלה. לחצו לניסיון חוזר.</Text></Pressable> : null}
        {data?.failedSources?.length ? <Card><Text style={{...font.body,color:colors.amber}}>מידע חלקי — לא נטענו: {data.failedSources.join(' · ')}. אין להסיק שהרשימות האלה ריקות.</Text></Card> : null}
        {data?.limitedSources?.length ? <Text style={{...font.small,color:colors.amber}}>הגעת לתקרת הקריאה: {data.limitedSources.join(' · ')}. הספירות חלקיות.</Text> : null}
        {data ? <>
          <Pressable accessibilityRole="button" onPress={()=> (nav as any).navigate('PersonJourney',{userId})} style={{padding:14,borderRadius:12,backgroundColor:colors.primarySoft}}><Text style={{...font.body,color:colors.primary}}>מסלול הכניסה והמעקב האישי ←</Text></Pressable>
          <Panel key={`overview:${userId}`} active={section==='overview'}><PlayerOverview data={data} onClubs={()=>{setSection('info');setFocusClubs(true)}} onInfo={()=>setSection('info')} onHistory={()=>setSection('history')} onReport={id=>(nav as any).getParent()?.navigate('DevInbox',{screen:'ErrorDetail',params:{id,collection:'feedback'}})}/></Panel>
          <Panel key={`info:${userId}`} active={section==='info'}>
            <SectionHeader>פרטי חשבון</SectionHeader>
            {[
              ['mail-outline','דוא״ל',data.user.email || 'לא תועד'],
              ['location-outline','עיר',data.user.city || 'לא תועדה'],
              ['calendar-outline','הצטרף בתאריך',data.user.joinedAt?new Date(data.user.joinedAt).toLocaleDateString('he-IL'):'לא תועד'],
            ].map(([icon,label,value])=><View key={label} style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:10,minHeight:48,borderBottomWidth:1,borderBottomColor:colors.border}}><Ionicons name={icon as never} size={21} color={colors.textSoft}/><Text style={font.small}>{label}</Text><Text selectable style={{ ...font.body,flex:1,textAlign: RTL_VALUE_ALIGN}}>{value}</Text></View>)}
            <SectionHeader>הרשמות ומועדונים</SectionHeader>
            <PlayerRounds rows={playerSummary(data).future}/>
            <View ref={clubsRef} collapsable={false}><PlayerClubs data={data} heading={false}/></View>
            <SectionHeader>מכשירים וגרסאות</SectionHeader>
            <UserDevicesCard userId={userId} flat/>
            <UserProfileInformation data={data} compact/>
            <Disclosure title="מחזורים ששיחק"><PlayerRounds rows={playerSummary(data).attended}/></Disclosure>
            <Disclosure title="מחזורים שיצר"><PlayerRounds rows={playerSummary(data).managed}/></Disclosure>
            <Disclosure title="פרטי רישום והתראות למכשירים"><PublicInformation userId={userId} source="push"/></Disclosure>
            <Disclosure title="חברים, הזמנות ובקשות"><UserRelationships data={data} onUser={id=>(nav as any).push('UserDetail',{userId:id})}/></Disclosure>
            <Disclosure title="קישור הזמנה ומקור הגעה"><><View style={styles.pStats}>
              <Stat label="מחזורים" value={`${data.user.attended}/${data.user.totalGames}`} />
              <Stat label="הישגים" value={String(data.user.achievements)} />
              <Stat label="חברים" value={String(data.user.friends)} />
            </View>
            {/* Personal-invite-link performance: how many tapped the link vs
                how many actually registered through it (conversion). */}
            {data ? (
              <View style={styles.inviteBox}>
                <View style={styles.inviteCell}>
                  <Text style={styles.inviteNum}>{data.referralCount}</Text>
                  <Text style={styles.inviteLbl}>נרשמו דרכו</Text>
                </View>
                <View style={styles.inviteDiv} />
                <View style={styles.inviteCell}>
                  <Text style={styles.inviteNum}>{data.inviteClicks}</Text>
                  <Text style={styles.inviteLbl}>קליקים על הקישור</Text>
                </View>
              </View>
            ) : null}
            <Pressable
              onPress={copyInviteLink}
              style={[styles.copyBtn, copied && styles.copyBtnOn]}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={16}
                color={copied ? colors.onPrimary : colors.primary}
              />
              <Text style={[styles.copyTxt, copied && { color: colors.onPrimary }]}>
                {copied ? 'הועתק ✓' : 'העתק לינק הזמנה אישי'}
              </Text>
            </Pressable>
            {data?.invitedByName ? (
              <Text style={styles.pRef}>📩 הוזמן ע״י {data.invitedByName}</Text>
            ) : (
              <Text style={styles.pRef}>📩 לא תועד מזמין אישי</Text>
            )}
            <Card style={styles.attributionCard}>
              <Text style={styles.pRefTitle}>מקור הכניסה שנשמר</Text>
              {data.entryAttribution || data.user.acquisition ? <>
                <Text style={styles.pRef}>סוג כניסה: {data.entryAttribution?.entrySource || 'לא תועד'}</Text>
                <Text style={styles.pRef}>ערוץ: {data.entryAttribution?.channel || data.user.acquisition?.source || 'לא תועד'}</Text>
                <Text style={styles.pRef}>קמפיין: {data.entryAttribution?.campaign || data.user.acquisition?.campaign || 'לא תועד'}</Text>
                <Text selectable style={styles.pRef}>מזהה קישור: {data.entryAttribution?.linkId || data.user.acquisition?.linkId || 'לא תועד'}</Text>
                <Text style={styles.pRef}>דרך: {data.entryAttribution?.resolvedBy || 'לא תועד'}</Text>
                <Text style={styles.pRef}>יעד: {[data.entryAttribution?.targetType, data.entryAttribution?.targetId].filter(Boolean).join(' · ') || 'לא תועד'}</Text>
                <Text style={styles.pRef}>מועד: {data.entryAttribution?.at || data.user.acquisition?.at ? new Date((data.entryAttribution?.at || data.user.acquisition?.at) as number).toLocaleString('he-IL') : 'לא תועד'}</Text>
                {data.entryAttribution?.sessionId ? <Text selectable style={styles.pRef}>מזהה ביקור: {data.entryAttribution.sessionId}</Text> : null}
              </> : <Text style={styles.pRef}>לא תועד מקור כניסה או קמפיין</Text>}
            </Card>
            {data && data.referredNames.length ? (
              <Text style={styles.pRef}>
                הזמין {data.referredNames.length}: {data.referredNames.slice(0, 4).join(', ')}
                {data.referredNames.length > 4 ? '…' : ''}
              </Text>
            ) : null}
</></Disclosure>
          </Panel>
        </> : null}
        {u && section === 'info' ? (
          <Disclosure title="כלי בדיקה">
          <Pressable onPress={toggleQa} disabled={qaSaving}>
            <Card style={[styles.qaCard, qa && styles.qaCardOn]}>
              <View style={styles.qaIcon}>
                <Ionicons
                  name={qa ? 'bug' : 'bug-outline'}
                  size={20}
                  color={qa ? colors.green : colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.qaTitle}>בודק (QA)</Text>
                <Text style={styles.qaSub}>
                  {qa
                    ? 'מקבל פופאפ דיווח בצילום מסך באפליקציה'
                    : 'משתמש רגיל — ללא כלי בדיקה'}
                </Text>
              </View>
              {qaSaving ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <View style={[styles.qaSwitch, qa && styles.qaSwitchOn]}>
                  <View style={[styles.qaKnob, qa && styles.qaKnobOn]} />
                </View>
              )}
            </Card>
          </Pressable></Disclosure>
        ) : null}


        <Panel key={`activity:${userId}`} active={section === 'history'}>
        {loading?<ActivityIndicator color={colors.primary}/>:loadFailed?<Pressable onPress={()=>setRetry(n=>n+1)}><Text style={styles.empty}>טעינת הפעילות נכשלה. לחצו לניסיון חוזר.</Text></Pressable>:data?<PlayerHistory data={data} onError={id=>(nav as any).getParent()?.navigate('DevInbox',{screen:'ErrorDetail',params:{id,collection:'errors'}})}/>:null}
        {qa || data?.related?.reports.length ? <Disclosure title="דיווחים ששלח המשתמש">{data?.related?.reports.length ? data.related.reports.map(report=><Pressable key={report.id} onPress={()=>(nav as any).getParent()?.navigate('DevInbox',{screen:'ErrorDetail',params:{id:report.id,collection:'feedback'}})}><Card><Text style={font.body}>{report.message || 'דיווח ללא טקסט'}</Text><Text style={font.small}>{report.status} · {report.screen} · {timeAgo(report.at)}</Text><Text style={{...font.body,color:colors.primary}}>פתיחת הדיווח והצילום</Text></Card></Pressable>) : <Text style={font.small}>לא נטענו דיווחים להצגה</Text>}</Disclosure> : null}
        <Disclosure title="התראות למשתמש"><UserRelatedRecords userId={userId} source="notifications"/></Disclosure>
        <Disclosure title="מסלול ההצטרפות"><UserRelatedRecords userId={userId} source="onboarding" onOpen={sessionId=>(nav as any).getParent()?.navigate('OnboardingActivity',{sessionId})}/></Disclosure>
        <Disclosure title="משימות משויכות"><UserRelatedRecords userId={userId} source="tasks"/></Disclosure>
        {data && data.errors.length ? (
          <Disclosure title="פירוט תקלות ומצב הטיפול">
            <SectionHeader>תקלות שהמשתמש חווה</SectionHeader>
            <Card style={{ gap: 2 }}>
              {data.errors.map((er) => {
                const emoji =
                  er.category === 'crash' ? '💥' : er.category === 'silent' ? '⚠️' : '❌';
                return (
                  <Pressable
                    key={er.id}
                    onPress={() =>
                      (nav as any).getParent()?.navigate('DevInbox', {
                        screen: 'ErrorDetail',
                        params: { id: er.id, collection: 'errors' },
                      })
                    }
                    style={styles.errRow}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.errTitle} numberOfLines={1}>
                        {emoji} {er.title}
                      </Text>
                      <Text style={styles.errMeta}>
                        ×{er.count} · {timeAgo(er.lastSeen)}
                      </Text>
                    </View>
                    <View style={[styles.errBadge, { backgroundColor: BUG_STATUS[er.status].color + '22' }]}>
                      <Text style={[styles.errBadgeTxt, { color: BUG_STATUS[er.status].color }]}>
                        {BUG_STATUS[er.status].label}
                      </Text>
                    </View>
                    <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
                  </Pressable>
                );
              })}
            </Card>
            <Text style={styles.errHint}>
              השיוך מבוסס על המשתמש האחרון בתקלה. מספר המקרים הוא מצטבר לתקלה, ולא בהכרח למשתמש הזה.
            </Text>
          </Disclosure>
        ) : null}
        </Panel>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', direction:'rtl',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...font.h2, flex: 1, textAlign: 'center' },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  tabs: {flexDirection:'row',direction:'rtl',borderBottomWidth:1,borderBottomColor:colors.border},
  tab: {flex:1,minHeight:48,alignItems:'center',justifyContent:'center',borderBottomWidth:2,borderBottomColor:'transparent'},
  profile: { gap: 6, backgroundColor:colors.bg, borderWidth:0, padding:0, paddingVertical:8 },
  pName: {  ...font.h1, fontSize: 24, textAlign: RTL_LABEL_ALIGN },
  pSub: {  ...font.body, textAlign: RTL_LABEL_ALIGN },
  pStats: { flexWrap: 'wrap', flexDirection: 'row', gap: 16, marginTop: 10 },
  stat: { alignItems: 'center' },
  statValue: { ...font.title, fontSize: 15 },
  statLabel: { ...font.small },
  pRef: { ...font.small, color: colors.textSoft, marginTop: 6 },
  pRefTitle: { ...font.title, color: colors.text },
  attributionCard: { marginTop: 10, gap: 2 },
  inviteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingVertical: 10,
    marginTop: 10,
  },
  inviteCell: { flex: 1, alignItems: 'center' },
  inviteDiv: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  inviteNum: { ...font.title, fontSize: 20, color: colors.primary },
  inviteLbl: { ...font.small, color: colors.textMuted, marginTop: 2 },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 9,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  copyBtnOn: { backgroundColor: colors.green, borderColor: colors.green },
  copyTxt: { ...font.title, fontSize: 13.5, color: colors.primary },
  // QA tester toggle
  qaCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  qaCardOn: { borderColor: colors.green, borderWidth: 1 },
  qaIcon: { width: 28, alignItems: 'center' },
  qaTitle: {  ...font.title, fontSize: 15, textAlign: RTL_LABEL_ALIGN },
  qaSub: {  ...font.small, color: colors.textMuted, marginTop: 1, textAlign: RTL_LABEL_ALIGN },
  qaSwitch: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.border,
    padding: 3,
    justifyContent: 'center',
  },
  qaSwitchOn: { backgroundColor: colors.green },
  qaKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  qaKnobOn: { alignSelf: 'flex-end' },
  empty: { ...font.body, color: colors.textMuted, textAlign: 'center', marginTop: 20 },
  // timeline
  tlRow: { flexDirection: 'row', gap: 12 },
  tlGutter: { alignItems: 'center', width: 26 },
  tlDot: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  tlBody: { flex: 1, paddingBottom: 16 },
  tlAction: { ...font.small, fontWeight: '700', marginBottom: 1 },
  tlTitle: { ...font.title, fontSize: 14 },
  tlSub: { ...font.small, color: colors.textSoft, marginTop: 1 },
  tlTime: { ...font.small, color: colors.textMuted, marginTop: 2 },
  // errors the user experienced
  errRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  errTitle: {  ...font.title, fontSize: 13.5, textAlign: RTL_LABEL_ALIGN },
  errMeta: {  ...font.small, color: colors.textMuted, marginTop: 1, textAlign: RTL_LABEL_ALIGN },
  errBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  errBadgeTxt: { fontSize: 11, fontWeight: '800' },
  errHint: {  ...font.small, color: colors.textMuted, marginTop: 6, textAlign: RTL_LABEL_ALIGN },
});
