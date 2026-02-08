import { createCanvas, type CanvasRenderingContext2D } from 'canvas'
import { writeFileSync, mkdirSync } from 'fs'

// --- Layout constants ---
const WIDTH = 800
const HEIGHT = 320
const BAR_H = 32
const BAR_X0 = 100
const BAR_X1 = 740
const GAP = 3 // pixel gap between segments
const RIBBON_ALPHA = 0.18

const SEG_COLORS = [
  '#60a5fa', // blue
  '#fb923c', // orange
  '#4ade80', // green
  '#c084fc', // purple
  '#f472b6', // pink
  '#facc15', // yellow
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
  proportion: number // relative width
  deleted?: boolean
  reversed?: boolean
  spacer?: boolean // visual gap separating chromosome groups
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
      // Draw chromosome label above the spacer
      ctx.fillStyle = '#94a3b8'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(seg.label, x + w / 2, y - 2)
      continue
    }

    if (seg.deleted) {
      // Dashed outline, light fill
      ctx.fillStyle = '#f1f5f9'
      ctx.fillRect(x, y, w, BAR_H)
      ctx.strokeStyle = '#cbd5e1'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.strokeRect(x, y, w, BAR_H)
      ctx.setLineDash([])

      // Strikethrough
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + 4, y + BAR_H / 2)
      ctx.lineTo(x + w - 4, y + BAR_H / 2)
      ctx.stroke()
    } else {
      // Filled rectangle
      ctx.fillStyle = seg.color
      ctx.fillRect(x, y, w, BAR_H)
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, w, BAR_H)
    }

    // Reversed arrow chevrons
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
      // Forward arrow chevrons
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

    // Segment label
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
  const h = 80 + totalBars * (BAR_H + 20) + (totalBars - 1) * 40 + 40
  const canvas = createCanvas(WIDTH, Math.max(HEIGHT, h))
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
  const startY = 68
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

    // Bar label
    ctx.fillStyle = '#64748b'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(bar.label, BAR_X0 - 10, y + BAR_H / 2)

    drawBar(ctx, bar, y, layout)
  }

  // "REF" and "ALT" labels
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

  // Breakpoint markers (small red triangles between ref segments)
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
    }
  }

  // Junction markers on alt bar (small lightning bolt / zigzag between adjacent alt segments from different ref sources)
  for (let bi = 0; bi < altCount; bi++) {
    const layout = altLayouts[bi]!
    const y = altYs[bi]!
    for (let si = 0; si < layout.length - 1; si++) {
      const seg = diagram.altBars[bi]!.segments[si]!
      const nextSeg = diagram.altBars[bi]!.segments[si + 1]!
      if (seg.spacer || nextSeg.spacer) {
        continue
      }
      const jx = layout[si]!.x + layout[si]!.w + GAP / 2
      ctx.strokeStyle = clsColor
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(jx, y + 2)
      ctx.lineTo(jx - 3, y + BAR_H * 0.33)
      ctx.lineTo(jx + 3, y + BAR_H * 0.66)
      ctx.lineTo(jx, y + BAR_H - 2)
      ctx.stroke()
    }
  }

  const buf = canvas.toBuffer('image/png')
  writeFileSync(outPath, buf)
  console.log(`Wrote ${outPath}`)
}

// --- Diagram definitions ---

const deletion: Diagram = {
  title: 'Deletion — segment B is lost',
  cls: 'DEL',
  refBars: [
    {
      label: 'chr1',
      segments: [
        { label: 'A', color: SEG_COLORS[0]!, proportion: 1 },
        { label: 'B', color: SEG_COLORS[1]!, proportion: 2, deleted: true },
        { label: 'C', color: SEG_COLORS[2]!, proportion: 1 },
      ],
    },
  ],
  altBars: [
    {
      label: 'der(1)',
      segments: [
        { label: 'A', color: SEG_COLORS[0]!, proportion: 1 },
        { label: 'C', color: SEG_COLORS[2]!, proportion: 1 },
      ],
    },
  ],
  connections: [
    { refBar: 0, refSeg: 0, altBar: 0, altSeg: 0 },
    { refBar: 0, refSeg: 2, altBar: 0, altSeg: 1 },
  ],
}

const inversion: Diagram = {
  title: 'Inversion — segment B is reversed',
  cls: 'INV',
  refBars: [
    {
      label: 'chr1',
      segments: [
        { label: 'A', color: SEG_COLORS[0]!, proportion: 1 },
        { label: 'B', color: SEG_COLORS[1]!, proportion: 2 },
        { label: 'C', color: SEG_COLORS[2]!, proportion: 1 },
      ],
    },
  ],
  altBars: [
    {
      label: 'der(1)',
      segments: [
        { label: 'A', color: SEG_COLORS[0]!, proportion: 1 },
        { label: 'B', color: SEG_COLORS[1]!, proportion: 2, reversed: true },
        { label: 'C', color: SEG_COLORS[2]!, proportion: 1 },
      ],
    },
  ],
  connections: [
    { refBar: 0, refSeg: 0, altBar: 0, altSeg: 0 },
    { refBar: 0, refSeg: 1, altBar: 0, altSeg: 1, reversed: true },
    { refBar: 0, refSeg: 2, altBar: 0, altSeg: 2 },
  ],
}

const translocation: Diagram = {
  title: 'Translocation — chr1 and chr2 exchange tails',
  cls: 'TRA',
  refBars: [
    {
      label: '',
      segments: [
        { label: 'A', color: SEG_COLORS[0]!, proportion: 2 },
        { label: 'B', color: SEG_COLORS[1]!, proportion: 2 },
        { label: 'chr1 | chr2', color: '', proportion: 0.6, spacer: true },
        { label: 'C', color: SEG_COLORS[2]!, proportion: 2 },
        { label: 'D', color: SEG_COLORS[3]!, proportion: 2 },
      ],
    },
  ],
  altBars: [
    {
      label: '',
      segments: [
        { label: 'A', color: SEG_COLORS[0]!, proportion: 2 },
        { label: 'D', color: SEG_COLORS[3]!, proportion: 2 },
        { label: 'der(1) | der(2)', color: '', proportion: 0.6, spacer: true },
        { label: 'C', color: SEG_COLORS[2]!, proportion: 2 },
        { label: 'B', color: SEG_COLORS[1]!, proportion: 2 },
      ],
    },
  ],
  connections: [
    // A stays in der(1)
    { refBar: 0, refSeg: 0, altBar: 0, altSeg: 0 },
    // D moves to der(1)
    { refBar: 0, refSeg: 4, altBar: 0, altSeg: 1 },
    // C stays in der(2)
    { refBar: 0, refSeg: 3, altBar: 0, altSeg: 3 },
    // B moves to der(2)
    { refBar: 0, refSeg: 1, altBar: 0, altSeg: 4 },
  ],
}

const complex: Diagram = {
  title: 'Complex — chromothripsis-like rearrangement',
  cls: 'COMPLEX',
  refBars: [
    {
      label: '',
      segments: [
        { label: 'A', color: SEG_COLORS[0]!, proportion: 1 },
        { label: 'B', color: SEG_COLORS[1]!, proportion: 2 },
        { label: 'C', color: SEG_COLORS[2]!, proportion: 2 },
        { label: 'D', color: SEG_COLORS[3]!, proportion: 2 },
        { label: 'E', color: SEG_COLORS[4]!, proportion: 1 },
        { label: 'chr1 | chr2', color: '', proportion: 0.6, spacer: true },
        { label: 'F', color: SEG_COLORS[5]!, proportion: 2 },
        { label: 'G', color: '#a78bfa', proportion: 2 },
        { label: 'H', color: '#f0abfc', proportion: 1 },
      ],
    },
  ],
  altBars: [
    {
      label: '',
      segments: [
        // Main derivative chain: A→D→G→C (one connected path through 3 junctions)
        { label: 'A', color: SEG_COLORS[0]!, proportion: 1 },
        { label: 'D', color: SEG_COLORS[3]!, proportion: 2 },
        { label: 'G', color: '#a78bfa', proportion: 2 },
        { label: 'C', color: SEG_COLORS[2]!, proportion: 2 },
        {
          label: 'derivative | remainders',
          color: '',
          proportion: 0.6,
          spacer: true,
        },
        // Leftover tails (disconnected from main derivative)
        { label: 'B', color: SEG_COLORS[1]!, proportion: 1.5, deleted: true },
        { label: 'E', color: SEG_COLORS[4]!, proportion: 0.8 },
        { label: 'F', color: SEG_COLORS[5]!, proportion: 1.5 },
        { label: 'H', color: '#f0abfc', proportion: 0.8 },
      ],
    },
  ],
  connections: [
    // Main derivative: A→D→G→C
    { refBar: 0, refSeg: 0, altBar: 0, altSeg: 0 }, // A
    { refBar: 0, refSeg: 3, altBar: 0, altSeg: 1 }, // D
    { refBar: 0, refSeg: 7, altBar: 0, altSeg: 2 }, // G
    { refBar: 0, refSeg: 2, altBar: 0, altSeg: 3 }, // C
    // Remainders
    { refBar: 0, refSeg: 1, altBar: 0, altSeg: 5 }, // B (lost)
    { refBar: 0, refSeg: 4, altBar: 0, altSeg: 6 }, // E (tail)
    { refBar: 0, refSeg: 6, altBar: 0, altSeg: 7 }, // F (tail)
    { refBar: 0, refSeg: 8, altBar: 0, altSeg: 8 }, // H (tail)
  ],
}

// --- Generate ---
mkdirSync('img', { recursive: true })
drawDiagram(deletion, 'img/deletion.png')
drawDiagram(inversion, 'img/inversion.png')
drawDiagram(translocation, 'img/translocation.png')
drawDiagram(complex, 'img/complex.png')
console.log('Done!')
