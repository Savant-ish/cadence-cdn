/**
 * TCGJSON sometimes publishes only one of the physical 1st Edition and
 * Unlimited variants for WotC-era Pokemon sets. These audited policies expand
 * an explicitly edition-bearing source product into both physical editions.
 * They never add a finish the source did not declare (for example, reverse
 * holofoil is intentionally absent from every set below).
 */
export const POKEMON_EDITION_POLICY_BY_TCGPLAYER_SET_ID = {
  '630': ['Unlimited', '1st Edition'], // Fossil
  '635': ['Unlimited', '1st Edition'], // Jungle
  '1373': ['Unlimited', '1st Edition'], // Team Rocket
  '1389': ['Unlimited', '1st Edition'], // Neo Revelation
  '1396': ['Unlimited', '1st Edition'], // Neo Genesis
  '1434': ['Unlimited', '1st Edition'], // Neo Discovery
  '1440': ['Unlimited', '1st Edition'], // Gym Challenge
  '1441': ['Unlimited', '1st Edition'], // Gym Heroes
  '1444': ['Unlimited', '1st Edition'], // Neo Destiny
  '1663': ['Unlimited', '1st Edition'], // Base Set (Shadowless)
} as const
