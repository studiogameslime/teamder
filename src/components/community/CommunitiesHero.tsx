import React from 'react';
import { FeedHero } from '@/components/FeedHero';
import { he } from '@/i18n/he';

export function CommunitiesHero({ onCreate }: { onCreate: () => void }) {
  return <FeedHero title={he.communitiesTitle} subtitle={he.communitiesHeroSubtitle}
    actionLabel={he.communitiesCreateShort} onCreate={onCreate}
    background={require('../../assets/images/communitiesTabBackground.png')} />;
}
