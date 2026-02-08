import type { Breakend, CopyNumberSegment, Link } from './types.ts'

const JCN_ZERO_THRESHOLD = 0.15
const JCN_MATCH_THRESHOLD = 0.5

// Compute the cluster allele JCN for a segment between two breakends,
// given copy number data. This is the total CN in the segment minus the
// "background" CN, giving the CN attributable to the rearrangement.
function segmentClusterJcn(
  chr: string,
  start: number,
  end: number,
  cnSegments: CopyNumberSegment[],
  backgroundPloidy = 2,
) {
  // Find CN segments overlapping this region
  const overlapping = cnSegments.filter(
    s => s.chr === chr && s.end > start && s.start < end,
  )
  if (overlapping.length === 0) {
    return undefined
  }

  // Weighted average CN over the region
  let totalCN = 0
  let totalLen = 0
  for (const s of overlapping) {
    const overlapStart = Math.max(s.start, start)
    const overlapEnd = Math.min(s.end, end)
    const len = overlapEnd - overlapStart
    totalCN += (s.majorAlleleCN + s.minorAlleleCN) * len
    totalLen += len
  }

  if (totalLen === 0) {
    return undefined
  }

  const avgCN = totalCN / totalLen
  return avgCN - backgroundPloidy
}

// Filter TI links that cross zero-JCN boundaries
export function filterLinksByCN(
  links: Link[],
  breakends: Breakend[],
  cnSegments: CopyNumberSegment[],
  backgroundPloidy = 2,
): Link[] {
  return links.filter(link => {
    const b1 = link.breakend1
    const b2 = link.breakend2

    if (b1.chr !== b2.chr) {
      return true // cross-chromosome links aren't filtered by segment CN
    }

    const start = Math.min(b1.pos, b2.pos)
    const end = Math.max(b1.pos, b2.pos)

    const clusterJcn = segmentClusterJcn(
      b1.chr,
      start,
      end,
      cnSegments,
      backgroundPloidy,
    )

    // Keep the link if we can't compute CN or if cluster JCN is above threshold
    if (clusterJcn === undefined) {
      return true
    }
    return clusterJcn >= JCN_ZERO_THRESHOLD
  })
}

// Check if two breakends have matching JCN (for link prioritization)
export function jcnMatch(b1: Breakend, b2: Breakend) {
  if (b1.jcn === undefined || b2.jcn === undefined) {
    return false
  }
  const diff = Math.abs(b1.jcn - b2.jcn)
  if (diff < JCN_MATCH_THRESHOLD) {
    return true
  }

  const unc1 = b1.jcnUncertainty ?? 0
  const unc2 = b2.jcnUncertainty ?? 0
  return diff < unc1 + unc2
}
