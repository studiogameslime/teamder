import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './ui';
import { colors, font } from '../theme';
import { sortedActions, type ActionReport } from '../services/actionReports';

export const trackedActions: Record<string,string> = {
  live_goal_recorded: 'הזנת שער במשחק חי',
  player_comparison_viewed: 'צפייה בהשוואת שחקנים',
  player_compare_tab_changed: 'החלפת לשונית בהשוואת שחקנים',
};
const nf = new Intl.NumberFormat('he-IL');
export function ActionReportCard({report,controls=false,onRetry}: {
  report:ActionReport; controls?:boolean; onRetry:()=>void;
}) {
  const [sort,setSort] = useState<'users'|'events'>('users');
  const [limit,setLimit] = useState(8);
  const rows = useMemo(()=>sortedActions(report.rows,sort),[report.rows,sort]);
  const sharedLabels = useMemo(()=>{
    const seen = new Set<string>(), repeated = new Set<string>();
    for (const row of report.rows) {if(seen.has(row.label))repeated.add(row.label);seen.add(row.label);}
    return repeated;
  },[report.rows]);
  const absent = controls || report.state !== 'ready' ? [] :
    Object.entries(trackedActions).filter(([id])=>!rows.some(row=>row.id===id));
  return <Card style={styles.card}>
    <Text style={font.h2}>{controls?'לחיצות בממשק':'פעולות באפליקציה'}</Text>
    <Text style={font.small}>{controls?'לחיצות על פקדים שנמדדו. לחיצה עשויה להסתיים גם בלי השלמת הפעולה.':'אנשים נספרים לפי הזיהוי של גוגל בתקופה שבחרת. אותו חשבון במכשירים שונים עשוי להיספר יותר מפעם אחת. ביצועים כוללים גם חזרות.'}</Text>
    {report.state==='unavailable' ? <Text style={font.body}>שירות המדידה אינו מחובר.</Text> :
      report.state==='error' ? <>
        <Text style={font.body}>לא הצלחנו לקרוא את כל נתוני הפעולות לתקופה הזאת.</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={onRetry}><Text style={styles.link}>ניסיון חוזר</Text></Pressable>
      </> : <>
      {report.thresholded && <Text style={font.small}>הדוח כפוף לסף פרטיות. חלק מהשורות עשויות להיות מוסתרות.</Text>}
      {report.sampled && <Text style={font.small}>הנתונים מבוססים על דגימה.</Text>}
      {report.other && <Text style={font.small}>חלק מהנתונים קובצו או התקבלו ללא זיהוי פעולה.</Text>}
      {rows.length ? <>
        <View style={styles.sort}>
          {(['users','events'] as const).map(key=><Pressable key={key} accessibilityRole="button" accessibilityState={{selected:sort===key}}
            onPress={()=>{setSort(key);setLimit(8);}} style={[styles.button,sort===key&&styles.selected]}>
            <Text style={styles.link}>{key==='users'?'לפי אנשים':'לפי ביצועים'}</Text></Pressable>)}
        </View>
        {rows.slice(0,limit).map(row=><View key={row.id} style={styles.item}>
          <Text style={font.title}>{row.label===row.id?'פעולה ללא תווית בעברית':row.label}</Text>
          {row.label===row.id && <Text style={font.small}>{'\u2066'+row.id+'\u2069'}</Text>}
          {controls && sharedLabels.has(row.label) && /^ui_[a-f0-9]+$/.test(row.id) &&
            <Text style={font.small}>{'מזהה פקד: \u2066'+row.id+'\u2069'}</Text>}
          <View style={styles.metrics}>
            <Text style={styles.value}>{'אנשים: '+nf.format(row.users)}</Text>
            <Text style={styles.value}>{'ביצועים: '+nf.format(row.events)}</Text>
          </View>
        </View>)}
        {limit<rows.length && <Pressable accessibilityRole="button" style={styles.button} onPress={()=>setLimit(n=>n+8)}><Text style={styles.link}>{'הצגת פעולות נוספות ('+nf.format(rows.length-limit)+')'}</Text></Pressable>}
        {limit>8 && <Pressable accessibilityRole="button" style={styles.button} onPress={()=>setLimit(8)}><Text style={styles.link}>הצגת פחות פעולות</Text></Pressable>}
      </> : <Text style={font.body}>לא התקבלו שורות לתקופה הזאת.</Text>}
      {absent.length>0 && <Text style={font.small}>{'טרם התקבלה שורה בתקופה הזאת עבור '+absent.map(([,name])=>name).join(', ')+'.'}</Text>}
    </>}
  </Card>;
}
const styles = StyleSheet.create({
  card:{gap:9},item:{gap:4,paddingVertical:8,borderTopColor:colors.border,borderTopWidth:StyleSheet.hairlineWidth},
  metrics:{flexDirection:'row',flexWrap:'wrap',columnGap:18,rowGap:3},
  value:{...font.body,color:colors.textSoft,fontVariant:['tabular-nums']},
  sort:{flexDirection:'row',flexWrap:'wrap',gap:6},button:{minHeight:44,justifyContent:'center',paddingHorizontal:10,borderRadius:8},
  selected:{backgroundColor:colors.primarySoft},link:{...font.small,color:colors.primary,fontWeight:'700'},
});
