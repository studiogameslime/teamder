import { create } from 'zustand';

// Global overlays sit outside the tab navigator, but share its safe viewport.
// Measure the whole footer, including the optional ad and its outer padding.
export const useDockHeight = create<number>(() => 0);
