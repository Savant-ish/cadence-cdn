export const GAME_REGISTRY = {
  pokemon: { name: 'Pokémon', tcgjsonArtifact: 'pokemon', taxonomy: 'pokemon' },
  lorcana: { name: 'Disney Lorcana', tcgjsonArtifact: 'lorcana' },
  onepiece: { name: 'One Piece Card Game', tcgjsonArtifact: 'one-piece' },
} as const

export type GameSlug = keyof typeof GAME_REGISTRY

export function isGameSlug(value: string): value is GameSlug {
  return value in GAME_REGISTRY
}
