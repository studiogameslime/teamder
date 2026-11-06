export type PhotoPhase = 'permission' | 'picking' | 'preparing' | 'uploading' | 'resolving';
export const photoPhaseLabel = (phase: PhotoPhase) => ({
  permission: 'בודקים גישה לתמונות',
  picking: 'בוחרים תמונה מהמכשיר',
  preparing: 'מכינים את התמונה להעלאה',
  uploading: 'מעלים את התמונה',
  resolving: 'מקבלים קישור לתמונה',
})[phase];
