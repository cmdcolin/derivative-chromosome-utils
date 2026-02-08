import type { Chain, SVClass } from './types.ts'

// Classify a chain based on its structure
export function classifyChain(chain: Chain): SVClass {
  if (chain.isClosed) {
    return 'COMPLEX' // ecDNA or circular rearrangement
  }

  // Classify by open-end breakend orientations when we have a simple pair
  if (chain.openStart && chain.openEnd && chain.segments.length <= 1) {
    const b1 = chain.openStart
    const b2 = chain.openEnd

    if (b1.chr !== b2.chr) {
      return 'TRA'
    }

    const [lower, upper] = b1.pos <= b2.pos ? [b1, b2] : [b2, b1]

    // DEL: lower faces right (+1), upper faces left (-1)
    if (lower.orientation === 1 && upper.orientation === -1) {
      return 'DEL'
    }
    // DUP: lower faces left (-1), upper faces right (+1)
    if (lower.orientation === -1 && upper.orientation === 1) {
      return 'DUP'
    }
    // INV: both face same direction
    if (lower.orientation === upper.orientation) {
      return 'INV'
    }

    return 'UNKNOWN'
  }

  if (chain.segments.length === 0) {
    return 'UNKNOWN'
  }

  // Multiple segments
  const chrs = new Set<string>()
  for (const seg of chain.segments) {
    chrs.add(seg.chr)
  }

  if (chrs.size > 1) {
    return chain.segments.length > 2 ? 'COMPLEX' : 'TRA'
  }

  // Multiple segments, single chromosome
  const hasInversion = chain.segments.some(s => s.orientation === 'reverse')
  if (chain.segments.length === 2 && hasInversion) {
    return 'INV'
  }

  if (chain.segments.length > 2) {
    return 'COMPLEX'
  }

  return 'UNKNOWN'
}

export function classifyChains(chains: Chain[]): Map<Chain, SVClass> {
  const result = new Map<Chain, SVClass>()
  for (const chain of chains) {
    result.set(chain, classifyChain(chain))
  }
  return result
}
