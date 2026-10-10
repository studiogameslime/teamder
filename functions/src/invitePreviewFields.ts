// Public invitation preview only. No roster, admin, rating or free-text fields.
const AVATAR_URLS: Record<string, string> = {
  "a01": "/avatars/avatar-25.jpg",
  "a02": "/avatars/avatar-26.jpg",
  "a03": "/avatars/avatar-33.jpg",
  "a04": "/avatars/avatar-27.jpg",
  "a05": "/avatars/avatar-04.jpg",
  "a06": "/avatars/avatar-23.jpg",
  "a07": "/avatars/avatar-02.jpg",
  "a08": "/avatars/avatar-24.jpg",
  "a09": "/avatars/avatar-07.jpg",
  "a11": "/avatars/avatar-17.jpg",
  "a13": "/avatars/avatar-10.jpg",
  "a15": "/avatars/avatar-11.jpg",
  "a17": "/avatars/avatar-05.jpg",
  "a19": "/avatars/avatar-20.jpg",
  "a21": "/avatars/avatar-13.jpg",
  "a22": "/avatars/avatar-01.jpg",
  "a23": "/avatars/avatar-08.jpg",
  "a24": "/avatars/avatar-16.jpg",
  "a25": "/avatars/avatar-03.jpg",
  "a26": "/avatars/avatar-06.jpg",
  "a27": "/avatars/avatar-09.jpg",
  "a28": "/avatars/avatar-12.jpg",
  "a29": "/avatars/avatar-14.jpg",
  "a30": "/avatars/avatar-15.jpg",
  "a31": "/avatars/avatar-18.jpg",
  "a32": "/avatars/avatar-19.jpg",
  "a33": "/avatars/avatar-21.jpg",
  "a34": "/avatars/avatar-22.jpg",
  "a35": "/avatars/avatar-28.jpg",
  "a36": "/avatars/avatar-29.jpg",
  "a37": "/avatars/avatar-30.jpg",
  "a38": "/avatars/avatar-31.jpg",
  "a39": "/avatars/avatar-32.jpg",
  "a40": "/avatars/avatar-34.jpg",
  "a41": "/avatars/avatar-35.jpg",
  "a42": "/avatars/avatar-36.jpg",
  "a10": "/avatars/avatar-24.jpg",
  "a12": "/avatars/avatar-23.jpg",
  "a14": "/avatars/avatar-23.jpg",
  "a16": "/avatars/avatar-24.jpg",
  "a18": "/avatars/avatar-23.jpg",
  "a20": "/avatars/avatar-24.jpg"
};
export function publicInviterFields(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, 120) : '';
  const avatar = typeof data.avatarId === 'string' && Object.prototype.hasOwnProperty.call(AVATAR_URLS, data.avatarId) ? AVATAR_URLS[data.avatarId] : undefined;
  let photo: string | undefined;
  if (typeof data.photoUrl === 'string') {
    try { const u = new URL(data.photoUrl); if (u.protocol === 'https:') photo = u.href; } catch { /* invalid photo omitted */ }
  }
  return { ...(name ? { inviterName: name } : {}), ...(photo ? { inviterPhotoUrl: photo } : {}), ...(avatar ? { inviterAvatarUrl: avatar } : {}) };
}
export function publicGameFields(d: Record<string, unknown>, now: number): Record<string, unknown> {
  const surface: Record<string, string> = { asphalt: 'אספלט', synthetic: 'דשא סינתטי', grass: 'דשא טבעי' };
  const opens = typeof d.registrationOpensAt === 'number' && Number.isFinite(d.registrationOpensAt) ? d.registrationOpensAt : undefined;
  const format = typeof d.format === 'string' && /^(3|4|5|6|7|8|9|10|11)v\1$/.test(d.format) ? d.format : undefined;
  return {
    ...(format ? { format } : {}),
    ...(typeof d.fieldType === 'string' && surface[d.fieldType] ? { surface: surface[d.fieldType] } : {}),
    ...(d.visibility === 'public' || d.visibility === 'community' ? { isPublic: d.visibility === 'public' } : {}),
    registrationClosed: d.status !== 'open' || !!(opens && opens > now),
    ...(opens && opens > now ? { registrationOpensAt: opens } : {}),
  };
}
export function previewId(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128 && !/[\/\x00-\x1f]/.test(value) ? value.trim() : '';
}

const COVER_URLS: Record<string, string> = {
  "c01": "/covers/park-aerial.jpg",
  "c02": "/covers/boots-training.jpg",
  "c03": "/covers/team-huddle.jpg",
  "c04": "/covers/keeper-save.jpg",
  "c05": "/covers/rural-pitch.jpg",
  "c06": "/covers/urban-rooftop.jpg",
  "c07": "/covers/bench-ready.jpg",
  "c08": "/covers/friends-celebrate.jpg",
  "c09": "/covers/goal-perspective.jpg",
  "c10": "/covers/captain-detail.jpg",
  "c11": "/covers/daylight-pitch.jpg",
  "c12": "/covers/daylight-ball.jpg",
  "c13": "/covers/daylight-team.jpg",
  "c14": "/covers/daylight-match.jpg",
  "c15": "/covers/daylight-coast.jpg",
  "c16": "/covers/daylight-friends.jpg"
};
export function publicCover(data: Record<string, unknown>, groupId: string): string | undefined {
  const uploaded = data.coverPhotoUrl ?? data.coverUrl;
  if (typeof uploaded === 'string') {
    try { const url = new URL(uploaded); if (url.protocol === 'https:') return url.href; } catch { /* invalid upload */ }
  }
  if (typeof data.coverImageId === 'string' && Object.prototype.hasOwnProperty.call(COVER_URLS, data.coverImageId)) return COVER_URLS[data.coverImageId];
  let hash = 0;
  for (const char of groupId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return COVER_URLS[`c${String(hash % 10 + 1).padStart(2, '0')}`];
}
