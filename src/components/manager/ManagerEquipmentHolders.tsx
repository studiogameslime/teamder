import React from 'react';
import type {ManagerData} from '@/services/managerDashboardService';
import {managerRoster} from '@/utils/managerWorkspace';
import {ManagerBox, ManagerLabel, ManagerLink, ManagerPerson, u} from './ManagerUi';
const stateText = {registered: 'רשום', waitlist: 'ברשימת המתנה', pending: 'ממתין לאישור', rejected: 'בקשתו נדחתה', cancelled: 'ביטל הרשמה', none: 'טרם נרשם'};
export function ManagerEquipmentHolders({data, now, onPlayer, onRound}: {data: ManagerData; now: number; onPlayer: (id: string) => void; onRound: (id: string) => void}) {
  const roster = managerRoster(data.group, data.games, now);
  const user = (id: string) => data.users.find(u => u.id === id) ?? {id, name: 'שחקן ללא פרטים', createdAt: 0};
  return <ManagerBox title="אצל מי הציוד עכשיו?" icon="cube-outline">{(['ball', 'jerseys'] as const).map(kind => {
    const holders = roster.gear.filter(h => h.kind === kind);
    return <React.Fragment key={kind}><ManagerLabel style={u.name}>{kind === 'ball' ? 'כדור' : 'גופיות'}</ManagerLabel>{holders.length ? holders.map(h => <ManagerPerson key={h.userId} user={user(h.userId)} subtitle={h.state ? `למחזור הקרוב: ${stateText[h.state]}` : 'אין מחזור עתידי שניתן להשוות אליו'} warning={h.state !== null && h.state !== 'registered'} badge={h.state === null ? undefined : stateText[h.state]} onPress={() => onPlayer(h.userId)}/>) : <ManagerLabel style={u.sub}>לא נשמר מחזיק לציוד הזה</ManagerLabel>}</React.Fragment>;
  })}<ManagerLabel style={u.sub}>לפי המחזיקים השמורים במועדון. היסטוריית לקיחות אינה מצב החזקה נוכחי.</ManagerLabel>{roster.upcoming && <ManagerLink title="לפרטי המחזור הקרוב" onPress={() => onRound(roster.upcoming!.id)}/>}</ManagerBox>;
}
