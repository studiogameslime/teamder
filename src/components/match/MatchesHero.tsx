import React from 'react';
import { FeedHero } from '@/components/FeedHero';
import { he } from '@/i18n/he';

export function MatchesHero({ onCreate }: { onCreate: () => void }) {
  return <FeedHero title={he.gamesListTitle} subtitle={he.roundFeedSubtitle}
    actionLabel={he.roundFeedCreate} onCreate={onCreate}
    background={require('../../assets/images/gamesTabBackground.png')} />;
}
