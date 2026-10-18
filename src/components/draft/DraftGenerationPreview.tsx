import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { TeamShirtIllustration } from '@/components/match/TeamShirt';
import { RTL_LABEL_ALIGN } from '@/theme';
import { gameFormatLabel } from '@/utils/format';
import { TEAM_PALETTE } from '@/utils/teamIdentity';

export function DraftGenerationPreview({ mode, players, teams, format, children }: {
  mode: 'auto' | 'random'; players: number; teams: number; format?: string; children?: React.ReactNode;
}) {
  const base = Math.floor(players / teams);
  const upper = Math.ceil(players / teams);
  const size = base === upper ? String(base) : `${base}–${upper}`;
  const automatic = mode === 'auto';
  const metrics: {value: string; label: string; icon: keyof typeof Ionicons.glyphMap}[] = [
    {value:String(players),label:'שחקנים',icon:'people-outline'},
    {value:String(teams),label:'קבוצות',icon:'shirt-outline'},
    {value:format ? gameFormatLabel(format).replace(/\s*×\s*/, ' על ') : '—',label:'פורמט המשחק',icon:'football-outline'},
  ];
  const info: {icon: keyof typeof Ionicons.glyphMap; text: string}[] = automatic ? [
    {icon:'stats-chart-outline',text:'הדירוג הפנימי משמש לאיזון בין הקבוצות'},
    {icon:'person-outline',text:'לשחקן ללא דירוג משתמשים בדירוג בסיס של 3 מתוך 5'},
  ] : [
    {icon:'shuffle-outline',text:'השחקנים מוגרלים לקבוצות, ללא שימוש בדירוג'},
    {icon:'people-outline',text:'מספר השחקנים מתחלק באופן שווה ככל האפשר'},
  ];
  return <>
    <View style={s.intro}>
      <View style={s.heroIcon}>{automatic ? <MaterialCommunityIcons name="scale-balance" size={42} color="#1851AF"/> : <Ionicons name="shuffle-outline" size={39} color="#1851AF"/>}</View>
      <View style={s.introText}><Text style={s.headline} numberOfLines={1} adjustsFontSizeToFit>{automatic ? 'מחלקים את הכוחות, שומרים על האיזון' : 'מערבבים את השחקנים, יוצרים קבוצות'}</Text>
        <Text style={s.subtitle}>{automatic ? 'חלוקה לפי הדירוג הפנימי של השחקנים' : 'חלוקה אקראית עם מספר שחקנים דומה בכל קבוצה'}</Text></View>
    </View>
    <View style={[s.card,s.metricsCard]}>
      <View style={s.metricsHeading}><View style={s.metricsHeadingIcon}><Ionicons name="grid-outline" size={16} color="#3263BA"/></View><Text style={s.metricsTitle}>נתוני הכוחות</Text></View>
      <View style={s.stats}>
        {metrics.map((item,index)=><View key={item.label} style={s.stat} accessible accessibilityLabel={`${item.value} ${item.label}`}>
          <Ionicons name={item.icon} size={22} color="#4775C6"/>
          <Text style={[s.value,index===2 && s.format]} numberOfLines={1} adjustsFontSizeToFit>{item.value}</Text>
          <Text style={s.label} numberOfLines={1} adjustsFontSizeToFit>{item.label}</Text>
        </View>)}
      </View>
    </View>
    <View style={s.card}>
      <Text style={s.title}>הקבוצות שייווצרו</Text>
      <View style={s.teams}>
        {Array.from({length:teams},(_,index)=>{
          const palette=TEAM_PALETTE[index];
          return <View key={index} style={[s.team,{backgroundColor:palette.hex+'0D',borderColor:palette.hex+'12'}]}>
            <TeamShirtIllustration color={palette.hex}/><Text style={s.teamName}>{palette.plural}</Text><Text style={s.teamSize}>{size} שחקנים</Text>
          </View>;
        })}
      </View>
      <Text style={s.teamNote}>{base === upper ? 'השחקנים ישובצו לאחר יצירת הכוחות' : 'גודל הקבוצות עשוי להשתנות בשחקן אחד. השיבוץ ייקבע ביצירת הכוחות'}</Text>
    </View>
    <View style={s.card}>
      <View style={s.infoHeading}><Ionicons name="sparkles-outline" size={23} color="#2D68FF"/><Text style={s.infoTitle}>איך החלוקה עובדת?</Text></View>
      {info.map((item,index)=><View key={item.text} style={[s.infoRow,index>0 && s.infoDivider]}><View style={s.infoIcon}><Ionicons name={item.icon} size={22} color="#193963"/></View><Text style={s.infoText}>{item.text}</Text></View>)}
    </View>
    {children}
    <View style={s.editNote}><Ionicons name="create-outline" size={22} color="#0C1942"/><Text style={s.editText}>אפשר לערוך את הקבוצות גם אחרי החלוקה</Text></View>
  </>;
}

const s=StyleSheet.create({
  intro:{flexDirection:'row',alignItems:'center',gap:14,marginTop:8,marginBottom:22},
  heroIcon:{width:64,height:70,borderRadius:22,backgroundColor:'#DFEBFF',alignItems:'center',justifyContent:'center'},
  introText:{flex:1,gap:7},headline:{fontSize:17,fontWeight:'800',color:'#0C1942',textAlign:RTL_LABEL_ALIGN,lineHeight:24},
  subtitle:{fontSize:14,color:'#586683',textAlign:RTL_LABEL_ALIGN,lineHeight:21},
  card:{backgroundColor:'#FFF',borderRadius:24,padding:18,marginBottom:14,borderWidth:1,borderColor:'#E8EFFA',shadowColor:'#537FCA',shadowOffset:{width:0,height:3},shadowOpacity:0.06,shadowRadius:10,elevation:1},
  title:{fontSize:20,fontWeight:'800',color:'#0C1942',textAlign:RTL_LABEL_ALIGN,marginBottom:18},
  metricsCard:{padding:16},metricsHeading:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:14},
  metricsHeadingIcon:{width:28,height:28,borderRadius:9,backgroundColor:'#ECF3FF',alignItems:'center',justifyContent:'center'},
  metricsTitle:{fontSize:18,fontWeight:'800',color:'#12234D',textAlign:RTL_LABEL_ALIGN,flex:1},
  stats:{flexDirection:'row',gap:8},stat:{flex:1,minWidth:0,alignItems:'center',justifyContent:'center',gap:5,paddingVertical:12,paddingHorizontal:5,borderRadius:17,backgroundColor:'#F4F8FF',borderWidth:1,borderColor:'#E5EEFC'},
  value:{fontSize:30,lineHeight:36,fontWeight:'800',color:'#173E83',fontVariant:['tabular-nums']},format:{fontSize:23},label:{fontSize:12,color:'#60718C'},
  teams:{flexDirection:'row',flexWrap:'wrap',gap:9},team:{width:'31%',flexGrow:1,maxWidth:'49%',alignItems:'center',paddingVertical:12,paddingHorizontal:3,borderRadius:17,borderWidth:1},
  teamName:{fontSize:16,fontWeight:'800',color:'#0C1942',marginTop:5},teamSize:{fontSize:13,color:'#59657F',marginTop:4},
  teamNote:{borderTopWidth:1,borderColor:'#E6EDF8',paddingTop:12,marginTop:14,fontSize:12,lineHeight:19,color:'#59657F',textAlign:'center'},
  infoHeading:{flexDirection:'row',alignItems:'center',gap:9,marginBottom:8},infoTitle:{flex:1,fontSize:20,fontWeight:'800',color:'#0C1942',textAlign:RTL_LABEL_ALIGN},
  infoRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:12},infoDivider:{borderTopWidth:1,borderColor:'#EAF0F8'},infoIcon:{width:34,height:34,borderRadius:17,backgroundColor:'#EAF3FF',alignItems:'center',justifyContent:'center'},infoText:{flex:1,fontSize:14,lineHeight:21,color:'#59657F',textAlign:RTL_LABEL_ALIGN},
  editNote:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,paddingVertical:8},editText:{fontSize:13,color:'#59657F',flexShrink:1},
});
