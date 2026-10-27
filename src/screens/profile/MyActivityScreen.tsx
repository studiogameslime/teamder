import { SPORTS_ACTIVITY_ENABLED } from '@/config/sportsActivity';
import { SafeModal as Modal } from '@/components/SafeModal';
import { observeCaughtError } from '@/utils/errorObservation';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScrollSurface } from '@/components/ScrollSurface';
import { MyActivityDashboard, activityIsolate } from '@/components/activity/MyActivityDashboard';
import { ActivityProviderIcon } from '@/components/activity/ActivityProviderIcon';
import { activityProvider, activityProviders, matchesActivityProvider, type ActivityProvider } from '@/utils/activityProviders';
import { useMyActivity } from '@/services/useMyActivity';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { PhoneActivityTest } from '@/components/activity/PhoneActivityTest';
import { phoneMeasurementAvailable } from '@/services/phoneActivity';

export function MyActivityScreen() {
  return SPORTS_ACTIVITY_ENABLED ? <EnabledMyActivityScreen /> : <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
    <ScreenHeader title="הפעילות שלי" />
    <Text style={s.body}>הפעילות אינה זמינה כרגע</Text>
  </SafeAreaView>;
}

export function EnabledMyActivityScreen() {
  const activity = useMyActivity();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ActivityProvider | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [help, setHelp] = useState(false);
  const [phoneTest, setPhoneTest] = useState(false);
  const selected = activity.sources.find(source => source.id === activity.selectedSourceId);
  const brand = selected ? activityProvider(selected.sourceId, selected.kind) : null;
  const ready = provider ? activity.sources.filter(source => provider.icon === 'watch'
    ? source.id === provider.id : matchesActivityProvider(source.sourceId, provider.id)) : [];
  useEffect(() => {
    if (attempted && !activity.refreshing && !activity.error && selected && provider &&
      (provider.icon === 'watch' ? selected.id === provider.id : matchesActivityProvider(selected.sourceId, provider.id))) {
      setOpen(false); setAttempted(false);
    }
  }, [attempted, activity.refreshing, activity.error, selected, provider]);
  const close = () => { if (!activity.refreshing) { setOpen(false); setAttempted(false); } };
  const choose = (value: ActivityProvider) => { setProvider(value); setAttempted(false); setHelp(false); };
  const begin = () => { setProvider(null); setAttempted(false); setHelp(false); setOpen(true); };
  return <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
    <ScreenHeader title="הפעילות שלי" />
    <ScrollSurface contentContainerStyle={s.content}>
      {phoneMeasurementAvailable ? <Pressable accessibilityRole="button" onPress={() => setPhoneTest(true)} style={s.source}>
        <Ionicons name="phone-portrait-outline" size={28} color="#2457F5" />
        <View style={s.grow}><Text style={s.sourceTitle}>בדיקת מדידה בטלפון</Text><Text style={s.body}>מהירות וספרינטים, כשהטלפון איתך</Text></View>
        <Ionicons name="chevron-back" size={20} color="#677B8D" />
      </Pressable> : null}
      <Pressable onPress={begin} disabled={activity.refreshing} accessibilityRole="button" accessibilityLabel={brand ? `ניהול החיבור אל ${brand.label}` : 'בחירת אפליקציה לסנכרון'} style={s.source}>
        <ActivityProviderIcon icon={brand?.icon ?? 'other'} />
        <View style={s.grow}><Text style={s.sourceTitle}>{brand?.label ?? 'חיבור הפעילות שלך'}</Text>
          <Text style={s.body}>{brand ? 'מחובר • החלפה וניהול' : 'בוחרים אפליקציה ומאשרים סנכרון'}</Text></View>
        <Ionicons name="chevron-back" size={20} color="#677B8D" />
      </Pressable>
      <View style={s.periodControl}>
        <Pressable onPress={activity.previousDay} disabled={!activity.canPreviousDay || activity.refreshing}
          accessibilityRole="button" accessibilityLabel="היום הקודם" style={s.dayButton}>
          <Ionicons name="chevron-forward" size={22} color={activity.canPreviousDay ? '#10283F' : '#BAC6CE'} />
        </Pressable>
        <Text style={[s.sourceTitle, s.grow]}>{activityIsolate(activity.periodLabel)}</Text>
        <Pressable onPress={activity.nextDay} disabled={!activity.canNextDay || activity.refreshing}
          accessibilityRole="button" accessibilityLabel="היום הבא" style={s.dayButton}>
          <Ionicons name="chevron-back" size={22} color={activity.canNextDay ? '#10283F' : '#BAC6CE'} />
        </Pressable>
      </View>
      <MyActivityDashboard status={activity.status} metrics={activity.metrics} scope="day"
        periodLabel={activity.periodLabel} sourceLabel={activity.sourceLabel}
        refreshing={activity.refreshing} lastUpdatedLabel={activity.lastUpdatedLabel}
        onConnect={begin} onRefresh={() => { void activity.refresh(); }} />
      {activity.dataNote ? <Text style={s.body}>{activity.dataNote}</Text> : null}
      {activity.error ? <Pressable accessibilityRole="button" onPress={begin} style={s.notice}>
        <Text accessibilityRole="alert" style={s.error}>{activity.error}</Text><Text style={s.link}>ניהול החיבור</Text>
      </Pressable> : null}
    </ScrollSurface>
    <Modal visible={phoneTest} animationType="slide" onRequestClose={() => setPhoneTest(false)}>
      {phoneTest ? <PhoneActivityTest onClose={() => setPhoneTest(false)} /> : null}
    </Modal>
    <Modal visible={open} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={s.screen}>
        <View style={s.modalHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel={provider ? 'חזרה לבחירת אפליקציה' : 'סגירה'} disabled={activity.refreshing}
            onPress={() => provider ? setProvider(null) : close()} style={s.dayButton}>
            <Ionicons name={provider ? 'arrow-forward' : 'close'} size={24} color="#10283F" />
          </Pressable>
          <Text accessibilityRole="header" style={s.title}>{provider ? `חיבור ${provider.label}` : 'מאיפה נסנכרן?'}</Text>
        </View>
        <ScrollSurface contentContainerStyle={s.content}>
          {!provider ? <>
            <Text style={s.body}>בחר את האפליקציה שבה נמצאת הפעילות שלך.</Text>
            {activityProviders.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => choose(item)} style={s.source}>
              <ActivityProviderIcon icon={item.icon} /><View style={s.grow}><Text style={s.sourceTitle}>{item.label}</Text><Text style={s.body}>{item.hint}</Text></View>
              <Ionicons name="chevron-back" size={20} color="#677B8D" />
            </Pressable>)}
            {activity.sources.filter(source => source.kind === 'wear-health-services' || activityProvider(source.sourceId).icon === 'other').map((source, index) => {
              const item = activityProvider(source.sourceId, source.kind);
              return <Pressable key={source.id} accessibilityRole="button" style={s.source} onPress={() => choose({ ...item, id: source.kind === 'wear-health-services' ? source.id : source.sourceId })}>
                <ActivityProviderIcon icon={item.icon} /><Text style={[s.sourceTitle, s.grow]}>{item.label}{item.icon === 'other' ? ` ${index + 1}` : ''}</Text>
                <Ionicons name="chevron-back" size={20} color="#677B8D" />
              </Pressable>;
            })}
            <Pressable accessibilityRole="button" disabled={activity.refreshing} onPress={() => { void activity.connect(); }} style={s.secondary}>
              <Text style={s.link}>{activity.refreshing ? 'מחפש...' : 'חיפוש שעון או אפליקציה נוספת'}</Text>
            </Pressable>
            <Text style={s.body}>הרשימה מציגה אפשרויות חיבור, ולא בדיקה של האפליקציות המותקנות.</Text>
          </> : <>
            <View style={s.intro}><ActivityProviderIcon icon={provider.icon} size={80} />
              <Text style={s.bigTitle}>הפעילות שלך, במקום אחד</Text>
              <Text style={s.centerCopy}>{provider.icon === 'phone' ? 'נסנכרן את הצעדים שהטלפון מודד.' : provider.icon === 'watch' ? 'נסנכרן את המדידות שהתחלת בשעון.' : `נסנכרן את הנתונים ש${provider.label} משתפת במאגר הבריאות בטלפון.`}</Text>
            </View>
            <View style={s.info}>
              <Text style={s.sourceTitle}>{provider.icon === 'phone' ? 'צעדים בלבד' : provider.icon === 'watch' ? 'מרחק, צעדים, מהירות וקלוריות' : 'מרחק, צעדים, מהירות וקלוריות פעילות'}</Text>
              <Text style={s.body}>לפי הנתונים הזמינים וההרשאות שלך. כל היום, גם לפני החיבור, ועד שלושים ימים לאחור.</Text>
              <View style={s.inline}><Ionicons name="lock-closed-outline" size={17} color="#17775F" /><Text style={[s.body, s.grow]}>הנתונים נשמרים בחשבון הפרטי שלך בענן. אפשר לנתק ולבטל הרשאות בכל זמן.</Text></View>
              {selected && brand && !ready.some(source => source.id === selected.id) ? <Text style={s.body}>החיבור יחליף את {brand.label}. לא נחבר נתונים משני מקורות.</Text> : null}
            </View>
            <Pressable disabled={activity.refreshing} accessibilityRole="button" accessibilityState={{ busy: activity.refreshing, disabled: activity.refreshing }} style={s.connect}
              onPress={() => { setAttempted(true); if (provider.icon === 'watch' && ready[0]) void activity.selectSource(ready[0].id); else void activity.connect(provider.id, true); }}>
              {activity.refreshing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.connectText}>אישור וחיבור</Text>}
            </Pressable>
            {attempted && activity.error ? <Text accessibilityRole="alert" style={s.error}>{activity.error}</Text> : null}
            {attempted && ready.length > 1 ? ready.map((source, i) => <Pressable key={source.id} accessibilityRole="button" style={s.source}
              onPress={() => { void activity.selectSource(source.id); }} disabled={activity.refreshing}><Text style={s.sourceTitle}>מכשיר {i + 1}</Text></Pressable>) : null}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: help }} onPress={() => setHelp(value => !value)} style={s.secondary}><Text style={s.link}>לא מופיעים נתונים?</Text></Pressable>
            {help ? <View style={s.info}><Text style={s.body}>{provider.icon === 'fit'
              ? 'בגוגל פיט פתח פרופיל, הגדרות, והפעל סנכרון עם מאגר הבריאות. אשר כתיבת נתוני פעילות ואז חזור לכאן.'
              : provider.icon === 'phone' ? 'הטלפון מספק צעדים בלבד. למדדי מרחק ומהירות בחר אפליקציית פעילות.'
              : provider.icon === 'watch' ? 'פתח את האפליקציה שלנו בשעון והתחל מדידה. לאחר סיומה ודא שהשעון מחובר לטלפון.'
              : 'פתח את אפליקציית הפעילות ואפשר שיתוף נתונים עם מאגר הבריאות. אם יש שעון, סנכרן אותו קודם עם האפליקציה שלו.'}</Text>
              <Text style={s.body}>החיבור זמין לאחר שהמקור שיתף נתונים בשבעת הימים האחרונים. זמינות סוגי הנתונים תלויה באפליקציה ובמכשיר.</Text></View> : null}
            <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL('https://teamderfc.web.app/privacy').catch(() => { observeCaughtError(new Error('Activity privacy link unavailable'), { source: 'src/screens/profile/MyActivityScreen.tsx', handler: 'openPrivacy', site: 'myActivity:privacy-link' }); setHelp(true); }); }} style={s.secondary}><Text style={s.body}>מדיניות הפרטיות</Text></Pressable>
            {selected && ready.some(source => source.id === selected.id) ? <Pressable accessibilityRole="button" disabled={activity.refreshing} onPress={() => { void activity.disconnect(); }} style={s.secondary}><Text style={s.error}>ניתוק החיבור</Text></Pressable> : null}
          </>}
          {!provider && activity.error ? <Text accessibilityRole="alert" style={s.error}>{activity.error}</Text> : null}
        </ScrollSurface>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F8FA' }, content: { padding: 16, paddingBottom: 40, gap: 14 },
  periodControl: { flexDirection: 'row', alignItems: 'center', gap: 10 }, dayButton: { padding: 10 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  title: { fontSize: 21, fontWeight: '800', color: '#10283F', textAlign: RTL_LABEL_ALIGN },
  bigTitle: { fontSize: 25, fontWeight: '800', color: '#10283F', textAlign: 'center' },
  body: { fontSize: 13, lineHeight: 21, color: '#677B8D', textAlign: RTL_LABEL_ALIGN },
  centerCopy: { fontSize: 14, lineHeight: 23, color: '#677B8D', textAlign: 'center' },
  source: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3EBEF', alignItems: 'center' },
  grow: { flex: 1, gap: 4 }, sourceTitle: { color: '#10283F', fontSize: 16, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  intro: { alignItems: 'center', paddingVertical: 20, gap: 16 },
  info: { padding: 18, borderRadius: 18, backgroundColor: '#FFFFFF', gap: 12 }, inline: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  connect: { minHeight: 52, padding: 15, borderRadius: 16, backgroundColor: '#17775F', alignItems: 'center', justifyContent: 'center' },
  connectText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }, secondary: { padding: 10, alignItems: 'center' },
  link: { color: '#17775F', fontSize: 14, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  notice: { padding: 14, gap: 8, backgroundColor: '#FFFFFF', borderRadius: 16 },
  error: { color: '#A23838', fontSize: 13, lineHeight: 20, textAlign: RTL_LABEL_ALIGN },
});
