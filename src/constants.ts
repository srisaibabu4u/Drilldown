// Small shared constants with no imports, so a Web Worker can use them without
// pulling in the map data.

export const AGE_BANDS = ['18–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80+']

/** Broad social categories used in Telangana. */
export const SOCIAL_GROUPS = [
  { key: 'SC', label: 'SC', name: 'Scheduled Castes' },
  { key: 'ST', label: 'ST', name: 'Scheduled Tribes' },
  { key: 'BC', label: 'BC', name: 'Backward Classes' },
  { key: 'OC', label: 'OC', name: 'Other Castes' },
]
