import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Path } from 'react-native-svg';
import { RTL_LABEL_ALIGN, clubShadow } from '@/theme';

/** Sample figures belong only to this labelled preview, never to statistics. */
export function CommunityStatsWelcome({ onCreate }: { onCreate?: () => void }) {
  return (
    <View style={s.wrap}>
      <View style={s.card}>
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={s.art}>
          <Svg width={196} height={126} viewBox="0 0 196 126">
            <Circle cx={98} cy={55} r={43} fill="#F0F6FF" />
            <Path d="M42 87H154L184 121H12Z M98 87V121 M40 97H59V113H28 M156 97H137V113H168 M77 104H119 M33 31L49 47 M163 31L147 47 M23 61H43 M173 61H153" fill="none" stroke="#77ADFF" strokeWidth={2} strokeLinejoin="round" />
            <Path d="M75 12H121V43Q121 65 98 70Q75 65 75 43Z M75 22H63V38Q63 53 80 56 M121 22H133V38Q133 53 116 56 M98 70V88 M85 88H111V96H85Z" fill="#F4F8FF" stroke="#142653" strokeWidth={2.5} strokeLinejoin="round" />
          </Svg>
        </View>
        <Text style={s.title}>כאן מתחילה ההיסטוריה שלכם</Text>
        <Text style={s.body}>אחרי המחזור הראשון תראו כאן את המספרים של המועדון.</Text>
        <View style={s.preview}>
          <Text style={s.previewTitle}>הצצה לסטטיסטיקות · דוגמה בלבד</Text>
          <View style={s.figures}>
            {([
              ['soccer-field', '3', 'משחקים'],
              ['soccer', '8', 'שערים'],
              ['shoe-cleat', '2', 'בישולים'],
            ] as const).map(([icon, value, label], index) => (
              <View key={label} style={[s.figure, index > 0 && s.figureDivider]}>
                <MaterialCommunityIcons name={icon} size={28} color="#2467F4" />
                <Text style={s.number}>{value}</Text>
                <Text style={s.figureLabel}>{label}</Text>
              </View>
            ))}
          </View>
          <View style={s.disclaimer}>
            <Text style={s.disclaimerText}>הנתונים להמחשה בלבד</Text>
            <Ionicons name="information-circle-outline" size={15} color="#728CB1" />
          </View>
        </View>
        {onCreate ? (
          <Pressable accessibilityRole="button" onPress={onCreate} style={({ pressed }) => [s.button, pressed && { opacity: 0.8 }]}>
            <Text style={s.buttonText}>פתח מחזור ראשון</Text>
            <Ionicons name="add" size={25} color="#FFF" />
          </Pressable>
        ) : null}
      </View>
      <View style={s.card}>
        <Text style={s.sectionTitle}>מה מחכה כאן בהמשך?</Text>
        {([
          ['bar-chart-outline', 'טבלת המועדון', 'מי מוביל לאורך העונה'],
          ['trophy-outline', 'מצטייני המחזורים', 'הביצועים שכדאי לזכור'],
          ['people-outline', 'השוואות בין שחקנים', 'שערים, בישולים וניצחונות'],
        ] as const).map(([icon, title, subtitle], index) => (
          <View key={title} style={[s.feature, index > 0 && s.featureDivider]}>
            <View style={s.featureCopy}>
              <Text style={s.featureTitle}>{title}</Text>
              <Text style={s.featureBody}>{subtitle}</Text>
            </View>
            <Ionicons name={icon} size={27} color="#2467F4" />
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 14, paddingTop: 4, paddingBottom: 16 },
  card: { backgroundColor: '#FFF', borderRadius: 18, padding: 16, ...clubShadow },
  art: { alignItems: 'center', marginTop: 2, marginBottom: 10 },
  title: { color: '#111B40', fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  body: { color: '#657696', fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 18 },
  preview: { backgroundColor: '#EDF5FF', borderColor: '#DFEBFF', borderWidth: 1, borderRadius: 14, padding: 12 },
  previewTitle: { color: '#2467F4', fontSize: 14, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  figures: { flexDirection: 'row', marginVertical: 18 },
  figure: { flex: 1, alignItems: 'center', gap: 5 },
  figureDivider: { borderStartWidth: 1, borderColor: '#D5E3F9' },
  number: { color: '#111B40', fontSize: 28, fontWeight: '800' },
  figureLabel: { color: '#344D79', fontSize: 14 },
  disclaimer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  disclaimerText: { color: '#728CB1', fontSize: 12 },
  button: { marginTop: 14, minHeight: 50, borderRadius: 12, backgroundColor: '#2467F4', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 10 },
  buttonText: { color: '#FFF', fontSize: 17, fontWeight: '700', flexShrink: 1 },
  sectionTitle: { color: '#111B40', fontSize: 20, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, marginBottom: 8 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15 },
  featureDivider: { borderTopWidth: 1, borderColor: '#E7ECF3' },
  featureCopy: { flex: 1, gap: 4 },
  featureTitle: { color: '#111B40', fontSize: 15, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  featureBody: { color: '#7A8AA6', fontSize: 13, textAlign: RTL_LABEL_ALIGN },
});
