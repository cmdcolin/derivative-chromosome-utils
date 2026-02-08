import { createCanvas } from 'canvas'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { parseVcfLines } from '../src/parseBreakends.ts'
import { deriveChromosomes } from '../src/deriveChromosomes.ts'
import { classifyChain } from '../src/classify.ts'
import type { Breakend, Chain } from '../src/types.ts'

const WIDTH = 800
const HEIGHT = 400
const MARGIN = { top: 60, right: 40, bottom: 60, left: 40 }
const COLORS = {
  bg: '#ffffff',
  chr: '#e2e8f0',
  chrStroke: '#94a3b8',
  del: '#ef4444',
  dup: '#3b82f6',
  inv: '#f59e0b',
  tra: '#8b5cf6',
  complex: '#ec4899',
  unknown: '#6b7280',
  text: '#1e293b',
  textLight: '#64748b',
  breakendPlus: '#059669',
  breakendMinus: '#dc2626',
  segment: '#2563eb',
}

function colorForClass(cls: string) {
  const map: Record<string, string> = {
    DEL: COLORS.del,
    DUP: COLORS.dup,
    INV: COLORS.inv,
    TRA: COLORS.tra,
    COMPLEX: COLORS.complex,
  }
  return map[cls] ?? COLORS.unknown
}

function drawBreakendDiagram(
  vcfPath: string,
  outPath: string,
  title: string,
) {
  const lines = readFileSync(vcfPath, 'utf-8').split('\n')
  const breakends = parseVcfLines(lines)
  const result = deriveChromosomes(breakends)

  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // Collect all chromosomes and positions for layout
  const chrSet = new Set<string>()
  let globalMin = Infinity
  let globalMax = -Infinity
  for (const b of breakends) {
    chrSet.add(b.chr)
    globalMin = Math.min(globalMin, b.pos)
    globalMax = Math.max(globalMax, b.pos)
    if (b.mateChr) {
      chrSet.add(b.mateChr)
    }
    if (b.matePos !== undefined) {
      globalMin = Math.min(globalMin, b.matePos)
      globalMax = Math.max(globalMax, b.matePos)
    }
  }

  const chrList = [...chrSet].sort()
  const chrCount = chrList.length
  const pad = (globalMax - globalMin) * 0.15 || 500

  // x scale: genomic position -> pixel
  const xMin = globalMin - pad
  const xMax = globalMax + pad
  const plotW = WIDTH - MARGIN.left - MARGIN.right
  const xScale = (pos: number) =>
    MARGIN.left + ((pos - xMin) / (xMax - xMin)) * plotW

  // y positions for each chromosome track
  const trackH = (HEIGHT - MARGIN.top - MARGIN.bottom) / Math.max(chrCount, 1)
  const chrY = new Map<string, number>()
  for (let i = 0; i < chrList.length; i++) {
    chrY.set(chrList[i]!, MARGIN.top + trackH * i + trackH * 0.5)
  }

  // Title
  ctx.fillStyle = COLORS.text
  ctx.font = 'bold 18px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(title, WIDTH / 2, 30)

  // Classification label
  if (result.chains.length > 0) {
    const cls = classifyChain(result.chains[0]!)
    ctx.fillStyle = colorForClass(cls)
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText(`Classified: ${cls}`, WIDTH / 2, 50)
  }

  // Draw chromosome tracks
  ctx.lineWidth = 2
  for (const [chr, y] of chrY) {
    ctx.strokeStyle = COLORS.chrStroke
    ctx.fillStyle = COLORS.chr
    const x1 = xScale(xMin + pad * 0.3)
    const x2 = xScale(xMax - pad * 0.3)
    ctx.beginPath()
    ctx.moveTo(x1, y)
    ctx.lineTo(x2, y)
    ctx.stroke()

    // Chromosome label
    ctx.fillStyle = COLORS.textLight
    ctx.font = '13px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(chr, x1 - 8, y + 4)
  }

  // Draw breakend positions as triangles showing orientation
  for (const b of breakends) {
    const x = xScale(b.pos)
    const y = chrY.get(b.chr)!
    const size = 8
    ctx.fillStyle =
      b.orientation === 1 ? COLORS.breakendPlus : COLORS.breakendMinus

    ctx.beginPath()
    if (b.orientation === 1) {
      // Right-pointing triangle
      ctx.moveTo(x - size, y - size)
      ctx.lineTo(x + size, y)
      ctx.lineTo(x - size, y + size)
    } else {
      // Left-pointing triangle
      ctx.moveTo(x + size, y - size)
      ctx.lineTo(x - size, y)
      ctx.lineTo(x + size, y + size)
    }
    ctx.closePath()
    ctx.fill()

    // Position label
    ctx.fillStyle = COLORS.textLight
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`${b.pos}`, x, y + 24)
    ctx.fillText(b.id, x, y - 16)
  }

  // Draw SV junctions as arcs between mate pairs
  const drawnPairs = new Set<string>()
  for (const b of breakends) {
    if (!b.mateId || !b.mateChr) {
      continue
    }
    const key = [b.id, b.mateId].sort().join(':')
    if (drawnPairs.has(key)) {
      continue
    }
    drawnPairs.add(key)

    const x1 = xScale(b.pos)
    const y1 = chrY.get(b.chr)!
    const x2 = xScale(b.matePos!)
    const y2 = chrY.get(b.mateChr)!

    const cls = classifyChain(result.chains[0]!)
    ctx.strokeStyle = colorForClass(cls)
    ctx.lineWidth = 2.5
    ctx.setLineDash([6, 3])

    if (y1 === y2) {
      // Same chromosome: draw arc above
      const midX = (x1 + x2) / 2
      const arcHeight = Math.min(Math.abs(x2 - x1) * 0.4, 80)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.quadraticCurveTo(midX, y1 - arcHeight, x2, y2)
      ctx.stroke()
    } else {
      // Different chromosomes: draw curved line
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.bezierCurveTo(midX - 30, y1, midX + 30, y2, x2, y2)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  // Draw derivative chain segments below
  const chainY = HEIGHT - MARGIN.bottom + 10
  if (result.chains.length > 0) {
    ctx.fillStyle = COLORS.textLight
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('Derivative chain:', MARGIN.left, chainY)

    const chain = result.chains[0]!
    const cls = classifyChain(chain)

    // Show chain as: open_start → [segments] → open_end
    let label = ''
    if (chain.openStart) {
      label += `${chain.openStart.chr}:${chain.openStart.pos}`
    }
    label += ' ⟶ '
    if (chain.segments.length > 0) {
      for (const seg of chain.segments) {
        label += `[${seg.chr}:${seg.start}-${seg.end} ${seg.orientation}] `
      }
      label += '⟶ '
    }
    if (chain.openEnd) {
      label += `${chain.openEnd.chr}:${chain.openEnd.pos}`
    }
    if (chain.isClosed) {
      label += ' (circular)'
    }

    ctx.fillStyle = colorForClass(cls)
    ctx.font = 'bold 12px sans-serif'
    ctx.fillText(label, MARGIN.left, chainY + 18)
  }

  // Legend
  const legendX = WIDTH - MARGIN.right - 120
  const legendY = MARGIN.top + 10
  ctx.font = '11px sans-serif'

  ctx.fillStyle = COLORS.breakendPlus
  ctx.fillRect(legendX, legendY, 10, 10)
  ctx.fillStyle = COLORS.textLight
  ctx.textAlign = 'left'
  ctx.fillText('orientation +1', legendX + 14, legendY + 9)

  ctx.fillStyle = COLORS.breakendMinus
  ctx.fillRect(legendX, legendY + 16, 10, 10)
  ctx.fillStyle = COLORS.textLight
  ctx.fillText('orientation -1', legendX + 14, legendY + 25)

  // Write PNG
  const buf = canvas.toBuffer('image/png')
  writeFileSync(outPath, buf)
  console.log(`Wrote ${outPath}`)
}

// Generate all visualizations
mkdirSync('img', { recursive: true })

drawBreakendDiagram(
  'test/fixtures/deletion.vcf',
  'img/deletion.png',
  'Deletion (DEL) — two breakends facing inward',
)
drawBreakendDiagram(
  'test/fixtures/inversion.vcf',
  'img/inversion.png',
  'Inversion (INV) — two breakends facing same direction',
)
drawBreakendDiagram(
  'test/fixtures/translocation.vcf',
  'img/translocation.png',
  'Translocation (TRA) — breakends on different chromosomes',
)
drawBreakendDiagram(
  'test/fixtures/complex.vcf',
  'img/complex.png',
  'Complex rearrangement — multi-breakpoint chain',
)

console.log('Done! Generated img/*.png')
