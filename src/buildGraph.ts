import type { Breakend, BreakendGraph, Link } from './types.ts'

// Build SV links from mate pairs
function buildSvLinks(breakends: Breakend[]): Link[] {
  const links: Link[] = []
  const byId = new Map<string, Breakend>()
  for (const b of breakends) {
    byId.set(b.id, b)
  }

  const seen = new Set<string>()
  for (const b of breakends) {
    if (b.mateId && !seen.has(b.id)) {
      const mate = byId.get(b.mateId)
      if (mate) {
        links.push({ type: 'SV', breakend1: b, breakend2: mate })
        seen.add(b.id)
        seen.add(mate.id)
      }
    }
  }
  return links
}

// Two breakends on the same chr are "facing" if the lower one has
// orientation -1 (faces left) and the upper has orientation +1 (faces right).
// The segment between them is a templated insertion (TI).
function isFacingPair(a: Breakend, b: Breakend) {
  if (a.chr !== b.chr) {
    return false
  }
  const [lower, upper] = a.pos <= b.pos ? [a, b] : [b, a]
  return lower.orientation === -1 && upper.orientation === 1
}

// Two breakends on the same chr form a deletion bridge (DB) if the lower
// one has orientation +1 (faces right) and the upper has orientation -1
// (faces left). The segment between them is lost.
function isDeletionBridge(a: Breakend, b: Breakend) {
  if (a.chr !== b.chr) {
    return false
  }
  const [lower, upper] = a.pos <= b.pos ? [a, b] : [b, a]
  return lower.orientation === 1 && upper.orientation === -1
}

// Find TI and DB links among breakends from different SV events.
// Only considers breakends that are not already mates of each other.
function buildTiAndDbLinks(breakends: Breakend[]) {
  const tiLinks: Link[] = []
  const dbLinks: Link[] = []

  // Group by chromosome
  const byChr = new Map<string, Breakend[]>()
  for (const b of breakends) {
    const list = byChr.get(b.chr)
    if (list) {
      list.push(b)
    } else {
      byChr.set(b.chr, [b])
    }
  }

  for (const [, chrBreakends] of byChr) {
    // Sort by position
    const sorted = [...chrBreakends].sort((a, b) => a.pos - b.pos)

    // Check all pairs for facing/DB relationships
    // In practice, LINX only considers adjacent or near-adjacent pairs,
    // but for Tier 1 we check all pairs in the same cluster proximity
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!
        const b = sorted[j]!

        // Skip if they are mates of each other (that's an SV link, not TI/DB)
        if (a.mateId === b.id || b.mateId === a.id) {
          continue
        }

        if (isFacingPair(a, b)) {
          tiLinks.push({ type: 'TI', breakend1: a, breakend2: b })
        } else if (isDeletionBridge(a, b)) {
          dbLinks.push({ type: 'DB', breakend1: a, breakend2: b })
        }
      }
    }
  }

  return { tiLinks, dbLinks }
}

export function buildGraph(breakends: Breakend[]): BreakendGraph {
  const svLinks = buildSvLinks(breakends)
  const { tiLinks, dbLinks } = buildTiAndDbLinks(breakends)

  return {
    breakends,
    svLinks,
    tiLinks,
    dbLinks,
  }
}
