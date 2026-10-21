import { observeCaughtError } from '../services/errorObservation';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Card } from './ui';
import { RTL_LABEL_ALIGN, colors  } from '../theme';
import { fetchUserDevices, type DeviceVersion } from '../services/deviceVersions';
import { timeAgo } from '../format';

const textStyle = { direction: 'rtl' as const, color: colors.text, textAlign: RTL_LABEL_ALIGN, lineHeight: 23 };
const platformName = (platform: string) => platform === 'android' ? 'אנדרואיד' : platform === 'ios' ? 'אפל' : 'מערכת לא ידועה';

export function UserDevicesCard({ userId, flat=false }: { userId: string; flat?:boolean }) {
  const [devices, setDevices] = useState<DeviceVersion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setDevices(null); setFailed(false);
    fetchUserDevices(userId, retry > 0).then(rows => { if (alive) setDevices(rows); })
      .catch((caughtError57e435d3ae: unknown) => {
    observeCaughtError(caughtError57e435d3ae, {"source":"pulse/src/components/DeviceVersions.tsx","handler":"UserDevicesCard","site":"DeviceVersions:57e435d3ae"}); if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [userId, retry]);
  return <Card style={{ gap: 8, ...(flat?{backgroundColor:'transparent',borderWidth:0,padding:0}: {}) }}>
    {!flat?<Text style={[textStyle, { fontWeight: '700' }]}>גרסאות ומכשירים</Text>:null}
    {devices !== null ? <Pressable accessibilityRole="button" onPress={()=>setRetry(n=>n+1)} style={{paddingVertical:12}}><Text style={[textStyle,{color:colors.primary}]}>רענון מכשירים</Text></Pressable> : null}
    {failed ? <Pressable onPress={() => setRetry(n => n + 1)}><Text style={textStyle}>לא ניתן לטעון מכשירים. לחצו לניסיון חוזר.</Text></Pressable>
      : devices === null ? <ActivityIndicator color={colors.primary} />
      : devices.length === 0 ? <Text style={textStyle}>אין גרסה מתועדת ברישום המכשירים.</Text>
      : devices.map((device, index) => <View key={index} style={{paddingVertical:12,borderBottomWidth:1,borderBottomColor:colors.border,gap:5}}>
        <View style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:10}}><Ionicons name="phone-portrait-outline" size={22} color={colors.textSoft}/><Text selectable style={[textStyle,{flex:1}]}>{device.device || 'מכשיר'} · {platformName(device.platform)}</Text><Text style={{color:colors.primary,borderColor:colors.primary,borderWidth:1,borderRadius:7,paddingHorizontal:8,paddingVertical:4}}>⁦{device.version}⁩</Text></View>
        <Text style={[textStyle, { color: colors.textMuted,fontSize:12 }]}>נצפתה {timeAgo(device.observedAt)}</Text>
      </View>)}
    <Text style={[textStyle, { color: colors.textMuted }]}>המידע נשמר בעת רישום להתראות. הוא עשוי להיות ישן ואינו מכסה מכשירים שלא נרשמו.</Text>
  </Card>;
}
