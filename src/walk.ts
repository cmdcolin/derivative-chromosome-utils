import type { Breakend } from './types.ts'

export interface RefSegment {
  chr: string
  start: number
  end: number
  index: number
}

export interface WalkSegment {
  chr: string
  start: number
  end: number
  orientation: 'forward' | 'reverse'
  segmentIndex: number
}

export interface WalkResult {
  refSegments: RefSegment[]
  chains: WalkSegment[][]
  orphanIndices: number[]
}

// Given a breakend, find which port it occupies in the segment graph.
// orient +1 → right port of segment ending at this position
// orient -1 → left port of segment starting at this position
function getBreakendPort(
  breakend: Breakend,
  chrSegments: Map<string, RefSegment[]>,
): string | undefined {
  const segs = chrSegments.get(breakend.chr)
  if (!segs) {
    return undefined
  }

  if (breakend.orientation === 1) {
    const seg = segs.find(s => s.end === breakend.pos)
    if (seg) {
      return `R${seg.index}`
    }
  } else {
    const seg = segs.find(s => s.start === breakend.pos)
    if (seg) {
      return `L${seg.index}`
    }
  }

  return undefined
}

export function walkBreakends(breakends: Breakend[]): WalkResult {
  // 1. Collect breakpoint positions per chromosome
  const chrPositions = new Map<string, Set<number>>()
  for (const b of breakends) {
    if (!chrPositions.has(b.chr)) {
      chrPositions.set(b.chr, new Set())
    }
    chrPositions.get(b.chr)!.add(b.pos)
  }

  // 2. Create reference segments between breakpoints
  // Use 0 as chromosome start and max_pos + 1000 as chromosome end
  const allSegments: RefSegment[] = []
  const chrSegments = new Map<string, RefSegment[]>()

  // Sort chromosome names for deterministic output
  const chrNames = [...chrPositions.keys()].sort()

  for (const chr of chrNames) {
    const posSet = chrPositions.get(chr)!
    const positions = [...posSet].sort((a, b) => a - b)
    const maxPos = positions[positions.length - 1]!
    const boundaries = [0, ...positions, maxPos + 1000]
    const segs: RefSegment[] = []
    for (let i = 0; i < boundaries.length - 1; i++) {
      const seg: RefSegment = {
        chr,
        start: boundaries[i]!,
        end: boundaries[i + 1]!,
        index: allSegments.length,
      }
      allSegments.push(seg)
      segs.push(seg)
    }
    chrSegments.set(chr, segs)
  }

  // 3. Build external port connections (junction + adjacency)
  // Port naming: "L{index}" = left port, "R{index}" = right port
  const externalConnections = new Map<string, string>()

  // Index breakends by chr:pos
  const breakendAt = new Map<string, Breakend[]>()
  for (const b of breakends) {
    const key = `${b.chr}:${b.pos}`
    if (!breakendAt.has(key)) {
      breakendAt.set(key, [])
    }
    breakendAt.get(key)!.push(b)
  }

  // Index breakends by ID for mate lookup
  const byId = new Map<string, Breakend>()
  for (const b of breakends) {
    byId.set(b.id, b)
  }

  // Process each boundary between adjacent segments
  for (const chr of chrNames) {
    const segs = chrSegments.get(chr)!
    for (let i = 0; i < segs.length - 1; i++) {
      const leftSeg = segs[i]!
      const rightSeg = segs[i + 1]!
      const boundaryPos = leftSeg.end

      const bAtPos = breakendAt.get(`${chr}:${boundaryPos}`) ?? []

      const leftPortId = `R${leftSeg.index}`
      const rightPortId = `L${rightSeg.index}`

      let leftSevered = false
      let rightSevered = false

      for (const b of bAtPos) {
        if (b.orientation === 1) {
          leftSevered = true
          const mate = b.mateId ? byId.get(b.mateId) : undefined
          if (mate) {
            const matePort = getBreakendPort(mate, chrSegments)
            if (matePort) {
              externalConnections.set(leftPortId, matePort)
              externalConnections.set(matePort, leftPortId)
            }
          }
        }
        if (b.orientation === -1) {
          rightSevered = true
          const mate = b.mateId ? byId.get(b.mateId) : undefined
          if (mate) {
            const matePort = getBreakendPort(mate, chrSegments)
            if (matePort) {
              externalConnections.set(rightPortId, matePort)
              externalConnections.set(matePort, rightPortId)
            }
          }
        }
      }

      // If neither side is severed, segments are adjacent (normal ref connection)
      if (!leftSevered && !rightSevered) {
        externalConnections.set(leftPortId, rightPortId)
        externalConnections.set(rightPortId, leftPortId)
      }
    }
  }

  // 4. Walk the graph
  const visited = new Set<number>()
  const chains: WalkSegment[][] = []

  // Find all free ports (no external connection) — these are chain endpoints
  const freePorts: string[] = []
  for (const seg of allSegments) {
    if (!externalConnections.has(`L${seg.index}`)) {
      freePorts.push(`L${seg.index}`)
    }
    if (!externalConnections.has(`R${seg.index}`)) {
      freePorts.push(`R${seg.index}`)
    }
  }

  // Walk from each free left port first, then free right ports
  // Prefer starting from left ports (forward entry) for cleaner output
  const sortedFreePorts = freePorts.sort((a, b) => {
    const aIsLeft = a.startsWith('L')
    const bIsLeft = b.startsWith('L')
    if (aIsLeft && !bIsLeft) {
      return -1
    }
    if (!aIsLeft && bIsLeft) {
      return 1
    }
    return parseInt(a.slice(1)) - parseInt(b.slice(1))
  })

  for (const startPort of sortedFreePorts) {
    const segIndex = parseInt(startPort.slice(1))
    if (visited.has(segIndex)) {
      continue
    }

    const chain: WalkSegment[] = []
    let currentPort = startPort

    while (true) {
      const idx = parseInt(currentPort.slice(1))
      if (visited.has(idx)) {
        break
      }
      visited.add(idx)

      const seg = allSegments[idx]!
      const isLeft = currentPort.startsWith('L')

      chain.push({
        chr: seg.chr,
        start: seg.start,
        end: seg.end,
        orientation: isLeft ? 'forward' : 'reverse',
        segmentIndex: idx,
      })

      // Exit through the other port
      const exitPort = isLeft ? `R${idx}` : `L${idx}`

      // Follow external connection
      const nextPort = externalConnections.get(exitPort)
      if (!nextPort) {
        break
      }

      currentPort = nextPort
    }

    if (chain.length > 0) {
      chains.push(chain)
    }
  }

  // Remaining unvisited segments are orphans (could be closed loops)
  const orphanIndices: number[] = []
  for (const seg of allSegments) {
    if (!visited.has(seg.index)) {
      orphanIndices.push(seg.index)
    }
  }

  return { refSegments: allSegments, chains, orphanIndices }
}
