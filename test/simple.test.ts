import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseVcfLines } from '../src/parseBreakends.ts'
import { buildGraph } from '../src/buildGraph.ts'
import { buildChains } from '../src/chain.ts'
import { classifyChain } from '../src/classify.ts'
import { deriveChromosomes } from '../src/deriveChromosomes.ts'
import { walkBreakends } from '../src/walk.ts'

function loadFixture(name: string) {
  const content = readFileSync(
    new URL(`./fixtures/${name}`, import.meta.url),
    'utf-8',
  )
  return content.split('\n')
}

describe('parseBreakends', () => {
  it('parses deletion BND records', () => {
    const breakends = parseVcfLines(loadFixture('deletion.vcf'))
    expect(breakends).toHaveLength(2)
    expect(breakends[0]!.id).toBe('bnd_a')
    expect(breakends[0]!.chr).toBe('chr1')
    expect(breakends[0]!.pos).toBe(1000)
    expect(breakends[0]!.orientation).toBe(1)
    expect(breakends[0]!.mateId).toBe('bnd_b')
    expect(breakends[0]!.mateChr).toBe('chr1')
    expect(breakends[0]!.matePos).toBe(2000)

    expect(breakends[1]!.id).toBe('bnd_b')
    expect(breakends[1]!.orientation).toBe(-1)
  })

  it('parses inversion BND records', () => {
    const breakends = parseVcfLines(loadFixture('inversion.vcf'))
    expect(breakends).toHaveLength(4)
    // First pair: A]chr1:2000] / C]chr1:1000] — both orient +1
    expect(breakends[0]!.orientation).toBe(1)
    expect(breakends[0]!.mateOrientation).toBe(-1)
    expect(breakends[1]!.orientation).toBe(1)
    expect(breakends[1]!.mateOrientation).toBe(-1)
    // Second pair: ]chr1:2000]A / ]chr1:1000]C — both orient -1
    expect(breakends[2]!.orientation).toBe(-1)
    expect(breakends[3]!.orientation).toBe(-1)
  })

  it('parses translocation BND records', () => {
    const breakends = parseVcfLines(loadFixture('translocation.vcf'))
    expect(breakends).toHaveLength(4)
    expect(breakends[0]!.chr).toBe('chr1')
    expect(breakends[0]!.mateChr).toBe('chr2')
    expect(breakends[1]!.chr).toBe('chr2')
    expect(breakends[1]!.mateChr).toBe('chr1')
    // Second pair for reciprocal translocation
    expect(breakends[2]!.orientation).toBe(-1)
    expect(breakends[3]!.orientation).toBe(1)
  })
})

describe('buildGraph', () => {
  it('builds SV links from mate pairs', () => {
    const breakends = parseVcfLines(loadFixture('deletion.vcf'))
    const graph = buildGraph(breakends)
    expect(graph.svLinks).toHaveLength(1)
    expect(graph.svLinks[0]!.breakend1.id).toBe('bnd_a')
    expect(graph.svLinks[0]!.breakend2.id).toBe('bnd_b')
  })
})

describe('deriveChromosomes', () => {
  it('produces chains from deletion breakends', () => {
    const breakends = parseVcfLines(loadFixture('deletion.vcf'))
    const result = deriveChromosomes(breakends)
    expect(result.chains.length).toBeGreaterThanOrEqual(1)
  })

  it('produces chains from translocation breakends', () => {
    const breakends = parseVcfLines(loadFixture('translocation.vcf'))
    const result = deriveChromosomes(breakends)
    expect(result.chains.length).toBeGreaterThanOrEqual(1)
  })

  it('produces chains from inversion breakends', () => {
    const breakends = parseVcfLines(loadFixture('inversion.vcf'))
    const result = deriveChromosomes(breakends)
    expect(result.chains.length).toBeGreaterThanOrEqual(1)
  })
})

describe('classifyChain', () => {
  it('classifies deletion', () => {
    const breakends = parseVcfLines(loadFixture('deletion.vcf'))
    const result = deriveChromosomes(breakends)
    const chain = result.chains[0]!
    const cls = classifyChain(chain)
    expect(cls).toBe('DEL')
  })

  it('classifies translocation', () => {
    const breakends = parseVcfLines(loadFixture('translocation.vcf'))
    const result = deriveChromosomes(breakends)
    const chain = result.chains[0]!
    const cls = classifyChain(chain)
    expect(cls).toBe('TRA')
  })
})

describe('walkBreakends', () => {
  it('walks deletion to produce A→C with B orphaned', () => {
    const breakends = parseVcfLines(loadFixture('deletion.vcf'))
    const walk = walkBreakends(breakends)
    expect(walk.refSegments).toHaveLength(3)
    expect(walk.chains).toHaveLength(2)
    // Main chain: A→C
    const main = walk.chains[0]!
    expect(main.segments).toHaveLength(2)
    expect(main.isClosed).toBe(false)
    expect(main.segments[0]!.orientation).toBe('forward')
    expect(main.segments[1]!.orientation).toBe('forward')
    // Isolated: B
    expect(walk.chains[1]!.segments).toHaveLength(1)
  })

  it('walks inversion to produce A→B(rev)→C', () => {
    const breakends = parseVcfLines(loadFixture('inversion.vcf'))
    const walk = walkBreakends(breakends)
    expect(walk.refSegments).toHaveLength(3)
    expect(walk.chains).toHaveLength(1)
    const chain = walk.chains[0]!
    expect(chain.segments).toHaveLength(3)
    expect(chain.isClosed).toBe(false)
    expect(chain.segments[0]!.orientation).toBe('forward')
    expect(chain.segments[1]!.orientation).toBe('reverse')
    expect(chain.segments[2]!.orientation).toBe('forward')
  })

  it('walks translocation to produce two derivative chromosomes', () => {
    const breakends = parseVcfLines(loadFixture('translocation.vcf'))
    const walk = walkBreakends(breakends)
    expect(walk.refSegments).toHaveLength(4)
    expect(walk.chains).toHaveLength(2)
    // der1: chr1:A + chr2:D
    const der1 = walk.chains[0]!
    expect(der1.segments).toHaveLength(2)
    expect(der1.segments[0]!.chr).toBe('chr1')
    expect(der1.segments[1]!.chr).toBe('chr2')
    // der2: chr2:C + chr1:B
    const der2 = walk.chains[1]!
    expect(der2.segments).toHaveLength(2)
    expect(der2.segments[0]!.chr).toBe('chr2')
    expect(der2.segments[1]!.chr).toBe('chr1')
  })

  it('walks complex rearrangement', () => {
    const breakends = parseVcfLines(loadFixture('complex.vcf'))
    const walk = walkBreakends(breakends)
    expect(walk.refSegments).toHaveLength(8)
    // 3 multi-segment derivatives + 2 isolated segments
    expect(walk.chains).toHaveLength(5)
    const multiChains = walk.chains.filter(c => c.segments.length > 1)
    expect(multiChains).toHaveLength(3)
  })

  it('walks duplication as a closed loop', () => {
    const breakends = parseVcfLines(loadFixture('duplication.vcf'))
    const walk = walkBreakends(breakends)
    expect(walk.refSegments).toHaveLength(3)
    // A and C are isolated open chains, B is a closed loop
    const closedLoops = walk.chains.filter(c => c.isClosed)
    expect(closedLoops).toHaveLength(1)
    expect(closedLoops[0]!.segments).toHaveLength(1)
    expect(closedLoops[0]!.segments[0]!.segmentIndex).toBe(1) // B
    // A and C are open
    const openChains = walk.chains.filter(c => !c.isClosed)
    expect(openChains).toHaveLength(2)
  })
})
