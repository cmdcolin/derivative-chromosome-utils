import type { Breakend, Cluster } from './types.ts'

const DEFAULT_PROXIMITY = 5000

// Cluster breakends by EVENT field or by proximity on the same chromosome
export function clusterBreakends(
  breakends: Breakend[],
  proximityThreshold = DEFAULT_PROXIMITY,
): Cluster[] {
  const clusters: Cluster[] = []
  const assigned = new Set<string>()

  // First pass: group by EVENT field
  const byEvent = new Map<string, Breakend[]>()
  for (const b of breakends) {
    if (b.event) {
      const list = byEvent.get(b.event)
      if (list) {
        list.push(b)
      } else {
        byEvent.set(b.event, [b])
      }
    }
  }

  let clusterId = 0
  for (const [event, eventBreakends] of byEvent) {
    clusters.push({
      id: `cluster_${clusterId++}`,
      breakends: eventBreakends,
      event,
    })
    for (const b of eventBreakends) {
      assigned.add(b.id)
    }
  }

  // Second pass: group by mate pairs
  const byId = new Map<string, Breakend>()
  for (const b of breakends) {
    byId.set(b.id, b)
  }

  for (const b of breakends) {
    if (assigned.has(b.id)) {
      continue
    }
    if (b.mateId) {
      const mate = byId.get(b.mateId)
      if (mate && !assigned.has(mate.id)) {
        clusters.push({
          id: `cluster_${clusterId++}`,
          breakends: [b, mate],
        })
        assigned.add(b.id)
        assigned.add(mate.id)
      }
    }
  }

  // Third pass: proximity-based clustering of remaining unassigned breakends
  const unassigned = breakends.filter(b => !assigned.has(b.id))
  const byChr = new Map<string, Breakend[]>()
  for (const b of unassigned) {
    const list = byChr.get(b.chr)
    if (list) {
      list.push(b)
    } else {
      byChr.set(b.chr, [b])
    }
  }

  for (const [, chrBreakends] of byChr) {
    const sorted = [...chrBreakends].sort((a, b) => a.pos - b.pos)
    let currentCluster: Breakend[] = [sorted[0]!]

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const curr = sorted[i]!
      if (curr.pos - prev.pos <= proximityThreshold) {
        currentCluster.push(curr)
      } else {
        clusters.push({
          id: `cluster_${clusterId++}`,
          breakends: currentCluster,
        })
        currentCluster = [curr]
      }
    }
    if (currentCluster.length > 0) {
      clusters.push({
        id: `cluster_${clusterId++}`,
        breakends: currentCluster,
      })
    }
  }

  return clusters
}
