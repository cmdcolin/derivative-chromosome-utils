import type {
  Breakend,
  Chain,
  CopyNumberSegment,
  DerivativeChromosome,
} from './types.ts'
import { buildGraph } from './buildGraph.ts'
import { clusterBreakends } from './cluster.ts'
import { buildChains } from './chain.ts'
import { filterLinksByCN } from './chainWithCN.ts'

export interface DeriveOptions {
  cnSegments?: CopyNumberSegment[]
  backgroundPloidy?: number
  proximityThreshold?: number
}

export function deriveChromosomes(
  breakends: Breakend[],
  options: DeriveOptions = {},
): DerivativeChromosome {
  const { cnSegments, backgroundPloidy, proximityThreshold } = options

  // Step 1: Cluster breakends
  const clusters = clusterBreakends(breakends, proximityThreshold)

  // Step 2: Build graph (SV links, TI links, DB links)
  const graph = buildGraph(breakends)

  // Step 3: Filter links by CN if copy number data is available
  let tiLinks = graph.tiLinks
  if (cnSegments && cnSegments.length > 0) {
    tiLinks = filterLinksByCN(tiLinks, breakends, cnSegments, backgroundPloidy)
  }

  // Step 4: Build chains
  const chains = buildChains(breakends, graph.svLinks, tiLinks)

  return {
    chains,
  }
}
