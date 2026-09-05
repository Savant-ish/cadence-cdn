export const GAME_REGISTRY = {
  pokemon: { name: 'Pokémon', taxonomy: 'pokemon' },
  lorcana: { name: 'Disney Lorcana' },
} as const

export type GameSlug = keyof typeof GAME_REGISTRY

export function isGameSlug(value: string): value is GameSlug {
  return value in GAME_REGISTRY
}
