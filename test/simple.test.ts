import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseVcfLines } from '../src/parseBreakends.ts'
import { buildGraph } from '../src/buildGraph.ts'
import { buildChains } from '../src/chain.ts'
import { classifyChain } from '../src/classify.ts'
import { deriveChromosomes } from '../src/deriveChromosomes.ts'

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
    expect(breakends).toHaveLength(2)
    // A]chr1:2000] → extends right of A, mate faces left → orientation +1, mateOrientation -1
    expect(breakends[0]!.orientation).toBe(1)
    expect(breakends[0]!.mateOrientation).toBe(-1)
    // C]chr1:1000] → extends right of C, mate faces left → orientation +1, mateOrientation -1
    expect(breakends[1]!.orientation).toBe(1)
    expect(breakends[1]!.mateOrientation).toBe(-1)
  })

  it('parses translocation BND records', () => {
    const breakends = parseVcfLines(loadFixture('translocation.vcf'))
    expect(breakends).toHaveLength(2)
    expect(breakends[0]!.chr).toBe('chr1')
    expect(breakends[0]!.mateChr).toBe('chr2')
    expect(breakends[1]!.chr).toBe('chr2')
    expect(breakends[1]!.mateChr).toBe('chr1')
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
