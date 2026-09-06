import { join } from 'node:path'
import type { NormalizedCatalog, SourceRelease } from '../domain/catalog.js'
import { GAME_REGISTRY } from '../config/games.js'
import { TcgjsonProvider, loadSnapshot } from '../providers/tcgjson/client.js'
import { deterministicTimestamp } from '../pipeline/ingest.js'
import { readJson } from '../util/json.js'

export async function loadAdminCatalog(
  snapshotRoot: string,
): Promise<NormalizedCatalog> {
  const provider = new TcgjsonProvider()
  const catalogs: NormalizedCatalog[] = []
  for (const game of Object.keys(GAME_REGISTRY)) {
    const root = join(snapshotRoot, game)
    const release = (await readJson(
      join(root, 'release.json'),
    )) as SourceRelease
    catalogs.push(
      await provider.normalize(
        await loadSnapshot(join(root, 'catalog.json')),
        { release, importedAt: deterministicTimestamp(release.id) },
        game,
      ),
    )
  }
  return {
    games: catalogs.flatMap((item) => item.games),
    sets: catalogs.flatMap((item) => item.sets),
    cards: catalogs.flatMap((item) => item.cards),
    printings: catalogs.flatMap((item) => item.printings),
  }
}
