import type { Breakend, Chain, ChainSegment, Link, LinkType } from './types.ts'

// Determine the priority of a potential TI/DB link
function scoreTiLink(
  link: Link,
  linkCounts: Map<string, number>,
): { priority: LinkType; score: number } {
  const count1 = linkCounts.get(link.breakend1.id) ?? 0
  const count2 = linkCounts.get(link.breakend2.id) ?? 0

  // ONLY: one or both breakends have exactly 1 possible link
  if (count1 === 1 || count2 === 1) {
    return { priority: 'ONLY', score: 4 }
  }

  // JCN_MATCH: junction copy numbers match
  if (link.breakend1.jcn !== undefined && link.breakend2.jcn !== undefined) {
    const diff = Math.abs(link.breakend1.jcn - link.breakend2.jcn)
    const unc1 = link.breakend1.jcnUncertainty ?? 0.5
    const unc2 = link.breakend2.jcnUncertainty ?? 0.5
    if (diff < 0.5 || diff < unc1 + unc2) {
      return { priority: 'JCN_MATCH', score: 2 }
    }
  }

  // NEAREST: fallback, scored by distance (shorter = higher score)
  const dist = Math.abs(link.breakend1.pos - link.breakend2.pos)
  return { priority: 'NEAREST', score: 1 / (1 + dist) }
}

// Check if two breakends in the sorted list are adjacent
// (no other breakends between them on the same chromosome)
function markAdjacentLinks(
  links: Link[],
  breakends: Breakend[],
): Map<Link, { priority: LinkType; score: number }> {
  const scores = new Map<Link, { priority: LinkType; score: number }>()

  // Sort breakends by chr then pos
  const sorted = [...breakends].sort((a, b) =>
    a.chr === b.chr ? a.pos - b.pos : a.chr.localeCompare(b.chr),
  )

  // Build adjacency set
  const adjacentPairs = new Set<string>()
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    if (a.chr === b.chr) {
      adjacentPairs.add(`${a.id}:${b.id}`)
      adjacentPairs.add(`${b.id}:${a.id}`)
    }
  }

  // Count possible links per breakend
  const linkCounts = new Map<string, number>()
  for (const link of links) {
    linkCounts.set(
      link.breakend1.id,
      (linkCounts.get(link.breakend1.id) ?? 0) + 1,
    )
    linkCounts.set(
      link.breakend2.id,
      (linkCounts.get(link.breakend2.id) ?? 0) + 1,
    )
  }

  for (const link of links) {
    const base = scoreTiLink(link, linkCounts)
    const key = `${link.breakend1.id}:${link.breakend2.id}`
    if (adjacentPairs.has(key) && base.priority === 'NEAREST') {
      scores.set(link, { priority: 'ADJACENT', score: 3 })
    } else {
      scores.set(link, base)
    }
  }

  return scores
}

function makeSegment(b1: Breakend, b2: Breakend): ChainSegment {
  if (b1.chr !== b2.chr) {
    // Cross-chromosome: just use b1's position as a point segment
    return {
      chr: b1.chr,
      start: b1.pos,
      end: b1.pos,
      orientation: 'forward',
    }
  }
  const [lower, upper] = b1.pos <= b2.pos ? [b1, b2] : [b2, b1]
  return {
    chr: lower.chr,
    start: lower.pos,
    end: upper.pos,
    orientation: 'forward',
  }
}

interface PartialChain {
  segments: ChainSegment[]
  breakendOrder: Breakend[] // track order of breakends in the chain
  startBreakend: Breakend | null
  endBreakend: Breakend | null
}

export function buildChains(
  breakends: Breakend[],
  svLinks: Link[],
  tiLinks: Link[],
): Chain[] {
  const usedBreakends = new Set<string>()
  const chains: PartialChain[] = []

  // Available TI links (we'll consume these greedily)
  const availableTiLinks = [...tiLinks]
  const scores = markAdjacentLinks(availableTiLinks, breakends)

  // Start by establishing SV-connected chains.
  // Each SV link connects two breakends on (possibly different) chromosomes.
  for (const svLink of svLinks) {
    const b1 = svLink.breakend1
    const b2 = svLink.breakend2

    chains.push({
      segments: [],
      breakendOrder: [b1, b2],
      startBreakend: b1,
      endBreakend: b2,
    })
  }

  // Greedily extend chains with TI links
  let changed = true
  while (changed) {
    changed = false

    // Sort available TI links by priority (highest first)
    const scoredLinks = availableTiLinks
      .filter(
        l =>
          !usedBreakends.has(l.breakend1.id) ||
          !usedBreakends.has(l.breakend2.id),
      )
      .map(l => ({
        link: l,
        ...(scores.get(l) ?? { priority: 'NEAREST' as LinkType, score: 0 }),
      }))
      .sort((a, b) => b.score - a.score)

    for (const { link } of scoredLinks) {
      const b1used = usedBreakends.has(link.breakend1.id)
      const b2used = usedBreakends.has(link.breakend2.id)

      // Skip if both already fully used
      if (b1used && b2used) {
        continue
      }

      // Find chains that have these breakends at their open ends
      let chain1Idx = -1
      let chain1End: 'start' | 'end' | null = null
      let chain2Idx = -1
      let chain2End: 'start' | 'end' | null = null

      for (let i = 0; i < chains.length; i++) {
        const c = chains[i]!
        if (c.startBreakend?.id === link.breakend1.id) {
          chain1Idx = i
          chain1End = 'start'
        } else if (c.endBreakend?.id === link.breakend1.id) {
          chain1Idx = i
          chain1End = 'end'
        }
        if (c.startBreakend?.id === link.breakend2.id) {
          chain2Idx = i
          chain2End = 'start'
        } else if (c.endBreakend?.id === link.breakend2.id) {
          chain2Idx = i
          chain2End = 'end'
        }
      }

      if (chain1Idx >= 0 && chain2Idx >= 0 && chain1Idx !== chain2Idx) {
        // Merge two chains via this TI link
        const seg = makeSegment(link.breakend1, link.breakend2)
        const c1 = chains[chain1Idx]!
        const c2 = chains[chain2Idx]!

        // Build merged chain: orient c1 so the matching end is last,
        // add the TI segment, then orient c2 so matching end is first
        const mergedSegments = [...c1.segments, seg, ...c2.segments]
        const mergedBreakends = [...c1.breakendOrder, ...c2.breakendOrder]

        const newStart = chain1End === 'end' ? c1.startBreakend : c1.endBreakend
        const newEnd = chain2End === 'start' ? c2.endBreakend : c2.startBreakend

        chains[chain1Idx] = {
          segments: mergedSegments,
          breakendOrder: mergedBreakends,
          startBreakend: newStart ?? null,
          endBreakend: newEnd ?? null,
        }

        // Remove the consumed chain
        chains.splice(chain2Idx, 1)
        usedBreakends.add(link.breakend1.id)
        usedBreakends.add(link.breakend2.id)
        changed = true
        break
      } else if (chain1Idx >= 0 && chain2Idx < 0) {
        // Extend chain1 with this link
        const seg = makeSegment(link.breakend1, link.breakend2)
        const c = chains[chain1Idx]!
        c.segments.push(seg)
        c.breakendOrder.push(link.breakend2)
        if (chain1End === 'end') {
          c.endBreakend = link.breakend2
        } else {
          c.startBreakend = link.breakend2
        }
        usedBreakends.add(link.breakend1.id)
        changed = true
        break
      } else if (chain2Idx >= 0 && chain1Idx < 0) {
        // Extend chain2 with this link
        const seg = makeSegment(link.breakend1, link.breakend2)
        const c = chains[chain2Idx]!
        c.segments.push(seg)
        c.breakendOrder.push(link.breakend1)
        if (chain2End === 'end') {
          c.endBreakend = link.breakend1
        } else {
          c.startBreakend = link.breakend1
        }
        usedBreakends.add(link.breakend2.id)
        changed = true
        break
      }
    }
  }

  // Convert partial chains to Chain objects
  return chains.map(c => {
    const isClosed =
      c.startBreakend !== null &&
      c.endBreakend !== null &&
      c.startBreakend.id === c.endBreakend.id

    return {
      segments: c.segments,
      openStart: isClosed ? null : c.startBreakend,
      openEnd: isClosed ? null : c.endBreakend,
      isClosed,
    }
  })
}

// Rebuild chain segments from the breakend traversal order,
// producing proper reference segments between consecutive breakend pairs
export function buildSegmentsFromBreakends(
  breakendOrder: Breakend[],
): ChainSegment[] {
  const segments: ChainSegment[] = []
  for (let i = 0; i < breakendOrder.length - 1; i += 2) {
    const b1 = breakendOrder[i]!
    const b2 = breakendOrder[i + 1]!

    if (b1.chr === b2.chr) {
      const [lower, upper] = b1.pos <= b2.pos ? [b1, b2] : [b2, b1]
      // If the lower breakend faces left (-1) and upper faces right (+1),
      // this is a forward-orientation segment (TI)
      const isInverted = lower.orientation === 1 && upper.orientation === -1
      segments.push({
        chr: lower.chr,
        start: lower.pos,
        end: upper.pos,
        orientation: isInverted ? 'reverse' : 'forward',
      })
    }
  }
  return segments
}
