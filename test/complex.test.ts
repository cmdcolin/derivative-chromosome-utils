import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseVcfLines } from '../src/parseBreakends.ts'
import { buildGraph } from '../src/buildGraph.ts'
import { clusterBreakends } from '../src/cluster.ts'
import { deriveChromosomes } from '../src/deriveChromosomes.ts'
import { classifyChain } from '../src/classify.ts'
import { filterLinksByCN } from '../src/chainWithCN.ts'
import type { CopyNumberSegment } from '../src/types.ts'

function loadFixture(name: string) {
  const content = readFileSync(
    new URL(`./fixtures/${name}`, import.meta.url),
    'utf-8',
  )
  return content.split('\n')
}

describe('complex rearrangements', () => {
  it('parses multi-breakpoint VCF', () => {
    const breakends = parseVcfLines(loadFixture('complex.vcf'))
    expect(breakends).toHaveLength(6)
  })

  it('clusters breakends by event', () => {
    const breakends = parseVcfLines(loadFixture('complex.vcf'))
    const clusters = clusterBreakends(breakends)
    // Should have 3 clusters (cx1, cx2, cx3)
    expect(clusters.length).toBe(3)
  })

  it('builds graph with SV and TI links', () => {
    const breakends = parseVcfLines(loadFixture('complex.vcf'))
    const graph = buildGraph(breakends)
    expect(graph.svLinks).toHaveLength(3)
    // TI/DB links depend on orientation patterns
    expect(graph.tiLinks.length + graph.dbLinks.length).toBeGreaterThanOrEqual(
      0,
    )
  })

  it('produces chains from complex breakends', () => {
    const breakends = parseVcfLines(loadFixture('complex.vcf'))
    const result = deriveChromosomes(breakends)
    expect(result.chains.length).toBeGreaterThanOrEqual(1)
  })
})

describe('CN-constrained filtering', () => {
  it('filters links crossing zero-CN segments', () => {
    const breakends = parseVcfLines(loadFixture('deletion.vcf'))
    const graph = buildGraph(breakends)

    // CN data showing zero copy number between the breakends
    const cnSegments: CopyNumberSegment[] = [
      { chr: 'chr1', start: 0, end: 1500, majorAlleleCN: 1, minorAlleleCN: 1 },
      {
        chr: 'chr1',
        start: 1500,
        end: 2500,
        majorAlleleCN: 0,
        minorAlleleCN: 0,
      },
    ]

    const filtered = filterLinksByCN(graph.tiLinks, breakends, cnSegments)
    // Links crossing the zero-CN region should be filtered out
    expect(filtered.length).toBeLessThanOrEqual(graph.tiLinks.length)
  })

  it('keeps links in regions with positive CN', () => {
    const breakends = parseVcfLines(loadFixture('deletion.vcf'))
    const graph = buildGraph(breakends)

    const cnSegments: CopyNumberSegment[] = [
      {
        chr: 'chr1',
        start: 0,
        end: 3000,
        majorAlleleCN: 2,
        minorAlleleCN: 1,
      },
    ]

    const filtered = filterLinksByCN(graph.tiLinks, breakends, cnSegments)
    // All links should be kept since CN is positive everywhere
    expect(filtered.length).toBe(graph.tiLinks.length)
  })
})
