// pitchCalibrationService — reads / writes the community's real-world pitch
// rectangle (4 GPS corners), stored ONCE per field on the group doc and reused
// by every future game's heatmap. Writes go through the savePitchCalibration
// callable (group doc is otherwise members-guarded).

import { doc, getDoc } from 'firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import { canonicalizeCorners, type LatLng } from '@/utils/physical';

export const pitchCalibrationService = {
  async loadCorners(groupId?: string): Promise<LatLng[] | null> {
    if (!groupId || USE_MOCK_DATA) return null;
    try {
      const snap = await getDoc(doc(getFirebase().db, 'groups', groupId));
      const cal = snap.exists()
        ? (snap.data().pitchCalibration as { corners?: Array<{ lat?: number; lng?: number }> } | undefined)
        : undefined;
      const corners = cal?.corners;
      if (!Array.isArray(corners) || corners.length !== 4) return null;
      const out = corners.map((c) => ({ lat: Number(c.lat), lng: Number(c.lng) }));
      if (out.some((c) => !Number.isFinite(c.lat) || !Number.isFinite(c.lng))) return null;
      return out;
    } catch (err) {
      logError('pitchCalibration.load', err, { groupId });
      return null;
    }
  },

  async saveCorners(groupId: string, corners: LatLng[]): Promise<boolean> {
    if (!groupId || corners.length !== 4) return false;
    // Canonicalize the marking order/direction into the winding the heatmap
    // expects (long axis = rows), so any perimeter walk produces the same,
    // non-transposed map.
    const canonical = canonicalizeCorners(corners);
    if (!canonical) return false;
    // Mock mode has no Firebase (getFirebase throws) — treat calibration as a
    // successful no-op so the emulator/demo flow completes.
    if (USE_MOCK_DATA) return true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { httpsCallable } = require('firebase/functions');
      await httpsCallable(getFirebase().functions, 'savePitchCalibration')({
        groupId,
        corners: canonical,
      });
      return true;
    } catch (err) {
      logError('pitchCalibration.save', err, { groupId });
      return false;
    }
  },
};
