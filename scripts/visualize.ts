import { createCanvas, type CanvasRenderingContext2D } from 'canvas'
import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { parseVcfLines } from '../src/parseBreakends.ts'
import { walkBreakends } from '../src/walk.ts'
import type { WalkResult, WalkChain, WalkSegment } from '../src/walk.ts'

// --- Layout constants ---
const WIDTH = 800
const BAR_H = 32
const BAR_X0 = 100
const BAR_X1 = 740
const GAP = 3
const RIBBON_ALPHA = 0.18

const SEG_COLORS = [
  '#60a5fa', // blue
  '#fb923c', // orange
  '#4ade80', // green
  '#c084fc', // purple
  '#f472b6', // pink
  '#facc15', // yellow
  '#a78bfa', // violet
  '#f0abfc', // fuchsia
  '#34d399', // emerald
  '#fbbf24', // amber
]

const CLS_COLORS: Record<string, string> = {
  DEL: '#ef4444',
  DUP: '#3b82f6',
  INV: '#f59e0b',
  TRA: '#8b5cf6',
  COMPLEX: '#ec4899',
}

// --- Data types ---
interface Seg {
  label: string
  color: string
  proportion: number
  deleted?: boolean
  reversed?: boolean
  spacer?: boolean
  looped?: boolean // closed loop (e.g. tandem duplication)
  segmentIndex?: number // links to ref segment for ribbon drawing
  chr?: string
  startPos?: number
  endPos?: number
}

interface Bar {
  label: string
  segments: Seg[]
}

interface Conn {
  refBar: number
  refSeg: number
  altBar: number
  altSeg: number
  reversed?: boolean
}

interface Diagram {
  title: string
  cls: string
  refBars: Bar[]
  altBars: Bar[]
  connections: Conn[]
}

// --- Layout helpers ---
function layoutBar(segments: Seg[]) {
  const totalProp = segments.reduce((s, seg) => s + seg.proportion, 0)
  const totalGap = GAP * Math.max(segments.length - 1, 0)
  const availW = BAR_X1 - BAR_X0 - totalGap
  let x = BAR_X0
  return segments.map(seg => {
    const w = (seg.proportion / totalProp) * availW
    const result = { x, w }
    x += w + GAP
    return result
  })
}

function formatPos(pos: number): string {
  if (pos >= 1_000_000) {
    return `${(pos / 1_000_000).toFixed(1)}Mb`
  }
  if (pos >= 1_000) {
    return `${(pos / 1_000).toFixed(0)}kb`
  }
  return `${pos}`
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}

// --- Drawing ---
function drawBar(
  ctx: CanvasRenderingContext2D,
  bar: Bar,
  y: number,
  layout: { x: number; w: number }[],
) {
  for (let i = 0; i < bar.segments.length; i++) {
    const seg = bar.segments[i]!
    const { x, w } = layout[i]!

    if (seg.spacer) {
      // Draw label only if provided (e.g. chromosome names on ref bar)
      if (seg.label) {
        ctx.fillStyle = '#94a3b8'
        ctx.font = '10px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(seg.label, x + w / 2, y - 2)
      }
      continue
    }

    if (seg.deleted) {
      ctx.fillStyle = '#f1f5f9'
      ctx.fillRect(x, y, w, BAR_H)
      ctx.strokeStyle = '#cbd5e1'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.strokeRect(x, y, w, BAR_H)
      ctx.setLineDash([])

      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + 4, y + BAR_H / 2)
      ctx.lineTo(x + w - 4, y + BAR_H / 2)
      ctx.stroke()
    } else {
      ctx.fillStyle = seg.color
      ctx.fillRect(x, y, w, BAR_H)
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, w, BAR_H)
    }

    // Chevrons for direction
    if (seg.reversed) {
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1.5
      const chevCount = Math.max(1, Math.floor(w / 20))
      const step = w / (chevCount + 1)
      for (let c = 1; c <= chevCount; c++) {
        const cx = x + step * c
        ctx.beginPath()
        ctx.moveTo(cx + 5, y + 6)
        ctx.lineTo(cx - 3, y + BAR_H / 2)
        ctx.lineTo(cx + 5, y + BAR_H - 6)
        ctx.stroke()
      }
    } else if (!seg.deleted) {
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1.5
      const chevCount = Math.max(1, Math.floor(w / 20))
      const step = w / (chevCount + 1)
      for (let c = 1; c <= chevCount; c++) {
        const cx = x + step * c
        ctx.beginPath()
        ctx.moveTo(cx - 5, y + 6)
        ctx.lineTo(cx + 3, y + BAR_H / 2)
        ctx.lineTo(cx - 5, y + BAR_H - 6)
        ctx.stroke()
      }
    }

    // Loop arrow for closed-loop segments (e.g. tandem duplication)
    if (seg.looped) {
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 2
      const cx = x + w - 16
      const cy = y - 8
      const r = 7
      ctx.beginPath()
      ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 0.1, false)
      ctx.stroke()
      // Arrowhead
      const ax = cx + r * Math.cos(Math.PI * 0.1)
      const ay = cy + r * Math.sin(Math.PI * 0.1)
      ctx.beginPath()
      ctx.moveTo(ax - 4, ay - 4)
      ctx.lineTo(ax, ay)
      ctx.lineTo(ax + 4, ay - 3)
      ctx.stroke()
    }

    // Label
    ctx.fillStyle = seg.deleted ? '#94a3b8' : '#1e293b'
    ctx.font = 'bold 13px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (w > 18) {
      ctx.fillText(seg.label, x + w / 2, y + BAR_H / 2)
    }
  }
}

function drawRibbon(
  ctx: CanvasRenderingContext2D,
  refLayout: { x: number; w: number },
  refY: number,
  altLayout: { x: number; w: number },
  altY: number,
  color: string,
  reversed: boolean,
) {
  const rgb = hexToRgb(color)
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${RIBBON_ALPHA})`
  ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`
  ctx.lineWidth = 1

  const rTop = refY + BAR_H
  const aTop = altY

  const rx1 = refLayout.x
  const rx2 = refLayout.x + refLayout.w
  let ax1: number, ax2: number
  if (reversed) {
    ax1 = altLayout.x + altLayout.w
    ax2 = altLayout.x
  } else {
    ax1 = altLayout.x
    ax2 = altLayout.x + altLayout.w
  }

  ctx.beginPath()
  ctx.moveTo(rx1, rTop)
  ctx.bezierCurveTo(
    rx1,
    rTop + (aTop - rTop) * 0.4,
    ax1,
    aTop - (aTop - rTop) * 0.4,
    ax1,
    aTop,
  )
  ctx.lineTo(ax2, aTop)
  ctx.bezierCurveTo(
    ax2,
    aTop - (aTop - rTop) * 0.4,
    rx2,
    rTop + (aTop - rTop) * 0.4,
    rx2,
    rTop,
  )
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}

function drawDiagram(diagram: Diagram, outPath: string) {
  const refCount = diagram.refBars.length
  const altCount = diagram.altBars.length
  const totalBars = refCount + altCount
  const h = 80 + totalBars * (BAR_H + 20) + (totalBars - 1) * 40 + 60
  const canvas = createCanvas(WIDTH, Math.max(320, h))
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, WIDTH, canvas.height)

  // Title
  ctx.fillStyle = '#1e293b'
  ctx.font = 'bold 18px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(diagram.title, WIDTH / 2, 14)

  // Classification pill
  const clsColor = CLS_COLORS[diagram.cls] ?? '#6b7280'
  ctx.fillStyle = clsColor
  ctx.font = 'bold 13px sans-serif'
  ctx.fillText(diagram.cls, WIDTH / 2, 38)

  // Compute Y positions
  const startY = 92
  const refYs: number[] = []
  let curY = startY
  for (let i = 0; i < refCount; i++) {
    refYs.push(curY)
    curY += BAR_H + 16
  }

  const ribbonGap = 60
  curY += ribbonGap - 16

  const altYs: number[] = []
  for (let i = 0; i < altCount; i++) {
    altYs.push(curY)
    curY += BAR_H + 16
  }

  // Draw ref bars
  const refLayouts: { x: number; w: number }[][] = []
  for (let i = 0; i < refCount; i++) {
    const bar = diagram.refBars[i]!
    const y = refYs[i]!
    const layout = layoutBar(bar.segments)
    refLayouts.push(layout)

    ctx.fillStyle = '#64748b'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(bar.label, BAR_X0 - 10, y + BAR_H / 2)

    drawBar(ctx, bar, y, layout)
  }

  // "REF" label
  const refMidY = (refYs[0]! + refYs[refCount - 1]! + BAR_H) / 2
  ctx.fillStyle = '#94a3b8'
  ctx.font = 'bold 11px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText('REF', BAR_X0 - 10, refMidY - 14)

  // Draw alt bars
  const altLayouts: { x: number; w: number }[][] = []
  for (let i = 0; i < altCount; i++) {
    const bar = diagram.altBars[i]!
    const y = altYs[i]!
    const layout = layoutBar(bar.segments)
    altLayouts.push(layout)

    ctx.fillStyle = '#64748b'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(bar.label, BAR_X0 - 10, y + BAR_H / 2)

    drawBar(ctx, bar, y, layout)
  }

  // "ALT" label
  const altMidY = (altYs[0]! + altYs[altCount - 1]! + BAR_H) / 2
  ctx.fillStyle = '#94a3b8'
  ctx.font = 'bold 11px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText('ALT', BAR_X0 - 10, altMidY - 14)

  // Draw ribbons
  for (const conn of diagram.connections) {
    const rLayout = refLayouts[conn.refBar]![conn.refSeg]!
    const aLayout = altLayouts[conn.altBar]![conn.altSeg]!
    const rY = refYs[conn.refBar]!
    const aY = altYs[conn.altBar]!
    const seg = diagram.refBars[conn.refBar]!.segments[conn.refSeg]!
    drawRibbon(ctx, rLayout, rY, aLayout, aY, seg.color, conn.reversed ?? false)
  }

  // Collect breakpoint pixel positions per ref bar for ruler tick suppression
  const breakpointPxByBar: Map<number, number[]> = new Map()
  for (let bi = 0; bi < refCount; bi++) {
    const layout = refLayouts[bi]!
    const bpPxs: number[] = []
    for (let si = 0; si < layout.length - 1; si++) {
      const seg = diagram.refBars[bi]!.segments[si]!
      const nextSeg = diagram.refBars[bi]!.segments[si + 1]!
      if (seg.deleted || nextSeg.deleted || seg.spacer || nextSeg.spacer) {
        continue
      }
      bpPxs.push(layout[si]!.x + layout[si]!.w + GAP / 2)
    }
    breakpointPxByBar.set(bi, bpPxs)
  }

  // Continuous ruler above ref bar
  for (let bi = 0; bi < refCount; bi++) {
    const layout = refLayouts[bi]!
    const y = refYs[bi]!
    const bar = diagram.refBars[bi]!
    const bpPxs = breakpointPxByBar.get(bi) ?? []

    for (let si = 0; si < bar.segments.length; si++) {
      const seg = bar.segments[si]!
      if (seg.spacer || seg.startPos === undefined || seg.endPos === undefined) {
        continue
      }
      const { x, w } = layout[si]!
      const genStart = seg.startPos
      const genEnd = seg.endPos
      const genSpan = genEnd - genStart
      if (genSpan <= 0 || w < 20) {
        continue
      }

      // Choose tick interval: aim for roughly every 40-80px
      const pxPerBp = w / genSpan
      const rawInterval = 60 / pxPerBp
      const magnitudes = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000]
      let interval = magnitudes[magnitudes.length - 1]!
      for (const m of magnitudes) {
        if (m >= rawInterval) {
          interval = m
          break
        }
      }

      const firstTick = Math.ceil(genStart / interval) * interval
      for (let pos = firstTick; pos <= genEnd; pos += interval) {
        const px = x + ((pos - genStart) / genSpan) * w
        // Skip ticks too close to a breakpoint (within 20px)
        const tooClose = bpPxs.some(bpPx => Math.abs(px - bpPx) < 20)
        if (tooClose) {
          continue
        }
        // Tick line
        ctx.strokeStyle = '#cbd5e1'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(px, y - 2)
        ctx.lineTo(px, y - 8)
        ctx.stroke()
        // Label
        ctx.fillStyle = '#94a3b8'
        ctx.font = '8px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(formatPos(pos), px, y - 9)
      }

      // Thin ruler line along top of segment
      ctx.strokeStyle = '#cbd5e1'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(x, y - 2)
      ctx.lineTo(x + w, y - 2)
      ctx.stroke()
    }
  }

  // Breakpoint markers (small red triangles + coordinate labels between ref segments)
  for (let bi = 0; bi < refCount; bi++) {
    const layout = refLayouts[bi]!
    const y = refYs[bi]!
    for (let si = 0; si < layout.length - 1; si++) {
      const seg = diagram.refBars[bi]!.segments[si]!
      const nextSeg = diagram.refBars[bi]!.segments[si + 1]!
      if (seg.deleted || nextSeg.deleted || seg.spacer || nextSeg.spacer) {
        continue
      }
      const bpX = layout[si]!.x + layout[si]!.w + GAP / 2
      ctx.fillStyle = '#ef4444'
      ctx.beginPath()
      ctx.moveTo(bpX, y - 6)
      ctx.lineTo(bpX - 4, y - 12)
      ctx.lineTo(bpX + 4, y - 12)
      ctx.closePath()
      ctx.fill()

      // Coordinate label in red, angled 45 degrees
      if (seg.endPos !== undefined) {
        ctx.save()
        ctx.translate(bpX, y - 14)
        ctx.rotate(-Math.PI / 4)
        ctx.fillStyle = '#ef4444'
        ctx.font = 'bold 9px sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(formatPos(seg.endPos), 0, 0)
        ctx.restore()
      }
    }
  }


  // Continuous ruler below alt bars
  for (let bi = 0; bi < altCount; bi++) {
    const layout = altLayouts[bi]!
    const y = altYs[bi]!
    const bar = diagram.altBars[bi]!

    for (let si = 0; si < bar.segments.length; si++) {
      const seg = bar.segments[si]!
      if (seg.spacer || seg.deleted || seg.startPos === undefined || seg.endPos === undefined) {
        continue
      }
      const { x, w } = layout[si]!
      const genStart = seg.startPos
      const genEnd = seg.endPos
      const genSpan = genEnd - genStart
      if (genSpan <= 0 || w < 20) {
        continue
      }

      const pxPerBp = w / genSpan
      const rawInterval = 60 / pxPerBp
      const magnitudes = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000]
      let interval = magnitudes[magnitudes.length - 1]!
      for (const m of magnitudes) {
        if (m >= rawInterval) {
          interval = m
          break
        }
      }

      const belowY = y + BAR_H
      const firstTick = Math.ceil(genStart / interval) * interval
      for (let pos = firstTick; pos <= genEnd; pos += interval) {
        const px = x + ((pos - genStart) / genSpan) * w
        ctx.strokeStyle = '#cbd5e1'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(px, belowY + 2)
        ctx.lineTo(px, belowY + 8)
        ctx.stroke()
        ctx.fillStyle = '#94a3b8'
        ctx.font = '8px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(formatPos(pos), px, belowY + 9)
      }

      // Thin ruler line along bottom of segment
      ctx.strokeStyle = '#cbd5e1'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(x, belowY + 2)
      ctx.lineTo(x + w, belowY + 2)
      ctx.stroke()
    }
  }

  const buf = canvas.toBuffer('image/png')
  writeFileSync(outPath, buf)
  console.log(`Wrote ${outPath}`)
}

// --- Auto-generate diagram from VCF ---

function segmentLabel(index: number): string {
  // A, B, C, ... Z, AA, AB, ...
  if (index < 26) {
    return String.fromCharCode(65 + index)
  }
  return String.fromCharCode(65 + Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26))
}

function segmentColor(index: number): string {
  return SEG_COLORS[index % SEG_COLORS.length]!
}

function classifyFromWalk(walk: WalkResult): string {
  const chrs = new Set(walk.refSegments.map(s => s.chr))
  // Closed loops indicate duplications
  if (walk.chains.some(c => c.isClosed)) {
    return 'DUP'
  }
  if (chrs.size > 1 && walk.chains.length > 1) {
    const hasMultiChr = walk.chains.some(chain => {
      const chainChrs = new Set(chain.segments.map(s => s.chr))
      return chainChrs.size > 1
    })
    if (hasMultiChr && walk.refSegments.length <= 4) {
      return 'TRA'
    }
    return 'COMPLEX'
  }
  if (walk.orphanIndices.length > 0) {
    return 'DEL'
  }
  if (walk.chains.length === 1 && chrs.size === 1) {
    const chain = walk.chains[0]!
    const hasReversed = chain.segments.some(s => s.orientation === 'reverse')
    if (hasReversed) {
      return 'INV'
    }
  }
  if (walk.chains.some(c => c.segments.length === 1 && !c.isClosed)) {
    return 'DEL'
  }
  return 'COMPLEX'
}

function titleForClass(cls: string): string {
  switch (cls) {
    case 'DEL':
      return 'Deletion'
    case 'DUP':
      return 'Duplication'
    case 'INV':
      return 'Inversion'
    case 'TRA':
      return 'Translocation'
    default:
      return 'Complex rearrangement'
  }
}

function buildDiagramFromWalk(walk: WalkResult, title?: string): Diagram {
  const { refSegments, chains, orphanIndices } = walk
  const orphanSet = new Set(orphanIndices)

  // Compute spacer proportion as a fraction of total genomic span
  const totalSpan = refSegments.reduce((s, seg) => s + (seg.end - seg.start), 0)
  const spacerProportion = totalSpan * 0.08

  // Group ref segments by chromosome
  const chrSegMap = new Map<string, number[]>()
  for (const seg of refSegments) {
    if (!chrSegMap.has(seg.chr)) {
      chrSegMap.set(seg.chr, [])
    }
    chrSegMap.get(seg.chr)!.push(seg.index)
  }
  const chrNames = [...chrSegMap.keys()].sort()

  // Build ref bar(s) — one bar with spacers between chromosomes
  const refBarSegs: Seg[] = []
  // Map from segment index → position in the flat ref bar
  const refSegPosition = new Map<number, { barIndex: number; segIndex: number }>()

  for (let ci = 0; ci < chrNames.length; ci++) {
    if (ci > 0) {
      refBarSegs.push({
        label: chrNames.slice(0, ci + 1).join(' | '),
        color: '',
        proportion: spacerProportion,
        spacer: true,
      })
    }
    const indices = chrSegMap.get(chrNames[ci]!)!
    for (const idx of indices) {
      const seg = refSegments[idx]!
      const segIdx = refBarSegs.length
      refBarSegs.push({
        label: segmentLabel(idx),
        color: segmentColor(idx),
        proportion: seg.end - seg.start,
        segmentIndex: idx,
        chr: seg.chr,
        startPos: seg.start,
        endPos: seg.end,
      })
      refSegPosition.set(idx, { barIndex: 0, segIndex: segIdx })
    }
  }

  const refBars: Bar[] = [{ label: '', segments: refBarSegs }]

  // Build alt bar(s) — separate derivative chains, loops, and orphans
  const altBars: Bar[] = []
  const connections: Conn[] = []

  // Categorize chains
  const mainChains = chains.filter(c => c.segments.length > 1 && !c.isClosed)
  const loopChains = chains.filter(c => c.isClosed)
  const isolatedChains = chains.filter(
    c => c.segments.length === 1 && !c.isClosed,
  )

  // Collect loops, isolated chains, and orphans
  const loopSegIndices = new Set<number>()
  for (const chain of loopChains) {
    for (const ws of chain.segments) {
      loopSegIndices.add(ws.segmentIndex)
    }
  }
  const isolatedSegIndices = new Set<number>()
  for (const chain of isolatedChains) {
    for (const ws of chain.segments) {
      isolatedSegIndices.add(ws.segmentIndex)
    }
  }

  const otherIndices: number[] = []
  for (const chain of loopChains) {
    for (const ws of chain.segments) {
      otherIndices.push(ws.segmentIndex)
    }
  }
  for (const chain of isolatedChains) {
    for (const ws of chain.segments) {
      otherIndices.push(ws.segmentIndex)
    }
  }
  for (const idx of orphanIndices) {
    otherIndices.push(idx)
  }
  otherIndices.sort((a, b) => a - b)

  // Build a single alt bar with all chains + other segments, separated by spacers
  const altBarIdx = altBars.length
  const altSegs: Seg[] = []

  // Add main chains
  for (let ci = 0; ci < mainChains.length; ci++) {
    if (altSegs.length > 0) {
      altSegs.push({ label: '', color: '', proportion: spacerProportion, spacer: true })
    }
    const chain = mainChains[ci]!
    for (const ws of chain.segments) {
      const altSegIdx = altSegs.length
      altSegs.push({
        label: segmentLabel(ws.segmentIndex),
        color: segmentColor(ws.segmentIndex),
        proportion: ws.end - ws.start,
        reversed: ws.orientation === 'reverse',
        segmentIndex: ws.segmentIndex,
        chr: ws.chr,
        startPos: ws.start,
        endPos: ws.end,
      })

      const refPos = refSegPosition.get(ws.segmentIndex)
      if (refPos) {
        connections.push({
          refBar: refPos.barIndex,
          refSeg: refPos.segIndex,
          altBar: altBarIdx,
          altSeg: altSegIdx,
          reversed: ws.orientation === 'reverse',
        })
      }
    }
  }

  // Add other segments (loops, isolated, orphans)
  // Skip deleted segments entirely; only add spacers between non-adjacent segments
  let lastOtherIdx = -1
  for (const idx of otherIndices) {
    const seg = refSegments[idx]!
    const isLoop = loopSegIndices.has(idx)
    const isIsolated = isolatedSegIndices.has(idx)
    const isOrphan = orphanSet.has(idx)
    const isDeleted = (isIsolated || isOrphan) && mainChains.length > 0

    if (isDeleted) {
      continue
    }

    const prevSeg = lastOtherIdx >= 0 ? refSegments[lastOtherIdx] : undefined
    const isAdjacent = prevSeg && prevSeg.chr === seg.chr && lastOtherIdx === idx - 1

    if (altSegs.length > 0 && !isAdjacent) {
      altSegs.push({ label: '', color: '', proportion: spacerProportion, spacer: true })
    }
    lastOtherIdx = idx

    const altSegIdx = altSegs.length

    altSegs.push({
      label: segmentLabel(idx),
      color: segmentColor(idx),
      proportion: seg.end - seg.start,
      looped: isLoop,
      segmentIndex: idx,
      chr: seg.chr,
      startPos: seg.start,
      endPos: seg.end,
    })

    const refPos = refSegPosition.get(idx)
    if (refPos) {
      connections.push({
        refBar: refPos.barIndex,
        refSeg: refPos.segIndex,
        altBar: altBarIdx,
        altSeg: altSegIdx,
      })
    }
  }

  if (altSegs.length > 0) {
    altBars.push({ label: 'der', segments: altSegs })
  }

  const cls = classifyFromWalk(walk)

  return {
    title: title ?? titleForClass(cls),
    cls,
    refBars,
    altBars,
    connections,
  }
}

// --- CLI ---
const args = process.argv.slice(2)

if (args.length < 2) {
  console.error('Usage: visualize.ts <input.vcf> <output.png> [--title "..."]')
  process.exit(1)
}

const vcfPath = args[0]!
const outPath = args[1]!

let title: string | undefined
const titleIdx = args.indexOf('--title')
if (titleIdx !== -1 && args[titleIdx + 1]) {
  title = args[titleIdx + 1]
}

const vcf = readFileSync(vcfPath, 'utf-8')
const breakends = parseVcfLines(vcf.split('\n'))
const walk = walkBreakends(breakends)
const diagram = buildDiagramFromWalk(walk, title)
drawDiagram(diagram, outPath)
