import React, { useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Workspace, type WorkspaceSection } from '../components/Workspace';
import { OverviewScreen } from './OverviewScreen';
import { AnalyticsScreen } from './AnalyticsScreen';
import { MapScreen } from './MapScreen';
import { CampaignsScreen } from './CampaignsScreen';
import { SegmentScreen } from './SegmentScreen';
import { SourcesScreen } from './SourcesScreen';
import { StickersScreen } from './StickersScreen';
import { PushScreen } from './PushScreen';
import { TokenHealthScreen } from './TokenHealthScreen';
import { NotificationsLogScreen } from './NotificationsLogScreen';
import { JoryioJourneyScreen } from './JoryioJourneyScreen';

const activity: WorkspaceSection[] = [
  { key: 'overview', label: 'סקירה', component: OverviewScreen },
  { key: 'analytics', label: 'מדדי שימוש', component: AnalyticsScreen },
  { key: 'map', label: 'מפה', component: MapScreen },
];
const growth: WorkspaceSection[] = [
  { key: 'journeys', label: 'מסעות', component: JoryioJourneyScreen },
  { key: 'campaigns', label: 'קמפיינים', component: CampaignsScreen },
  { key: 'audiences', label: 'קהלים', component: SegmentScreen },
  { key: 'links', label: 'קישורים', component: SourcesScreen },
  { key: 'stickers', label: 'מדבקות', component: StickersScreen },
];
const notifications: WorkspaceSection[] = [
  { key: 'delivery', label: 'שליחה', component: PushScreen },
  { key: 'reach', label: 'קבלת התראות', component: TokenHealthScreen },
  { key: 'history', label: 'יומן', component: NotificationsLogScreen },
];
export const ActivityWorkspace = () => <Workspace title="פעילות ומדדים" sections={activity} />;
export const GrowthWorkspace = () => <Workspace title="גיוס וקשר" sections={growth} />;
export const NotificationsWorkspace = () => <Workspace title="מרכז ההתראות" sections={notifications} />;
/** Preserve old deep links while keeping one mounted workspace per domain. */
export function workspaceAlias(target: string, section: string) {
  return function WorkspaceAlias() {
    const nav = useNavigation<any>();
    useFocusEffect(useCallback(() => { nav.navigate(target, { section, sectionRequest: Date.now() }); }, [nav]));
    return null;
  };
}
