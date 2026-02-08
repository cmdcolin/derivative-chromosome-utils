import type { Breakend } from './types.ts'

// Parses a BND ALT field like "N]chr2:321681]" or "G]17:198982]" into
// structured mate info. Pattern from VCF 4.3 spec: s]p] s[p[ ]p]s [p[s
function parseAlt(alt: string) {
  // pattern: piece of reference on one side, bracket+chr:pos+bracket on the other
  const bracketMatch = alt.match(/^(.?)(\[|\])(.+?):(\d+)(\[|\])(.?)$/)
  if (!bracketMatch) {
    return undefined
  }
  const [, prefixBase, bracket1, mateChr, matePosStr, _bracket2, suffixBase] =
    bracketMatch
  const matePos = Number(matePosStr)

  // Determine orientations from the bracket pattern:
  // t[p[ → extends right of t, mate extends right of p → +1, +1 → this breaks: pos connects to mate in forward
  // t]p] → extends right of t, mate extends left of p → +1, -1
  // ]p]t → extends left of t, mate extends left of p → -1, -1
  // [p[t → extends left of t, mate extends right of p → -1, +1

  let orientation: 1 | -1
  let mateOrientation: 1 | -1

  if (prefixBase && !suffixBase) {
    // t[p[ or t]p] — sequence to the right of this breakpoint joins mate
    orientation = 1
    mateOrientation = bracket1 === ']' ? -1 : 1
  } else if (!prefixBase && suffixBase) {
    // ]p]t or [p[t — sequence to the left of this breakpoint joins mate
    orientation = -1
    mateOrientation = bracket1 === ']' ? -1 : 1
  } else {
    return undefined
  }

  return {
    mateChr: mateChr!,
    matePos,
    orientation,
    mateOrientation,
  }
}

export function parseBreakendRecord(fields: {
  chrom: string
  pos: number
  id: string
  alt: string
  info: Record<string, string | undefined>
}): Breakend | undefined {
  const parsed = parseAlt(fields.alt)
  if (!parsed) {
    return undefined
  }

  return {
    id: fields.id,
    chr: fields.chrom,
    pos: fields.pos,
    orientation: parsed.orientation,
    mateId: fields.info['MATEID'],
    mateChr: parsed.mateChr,
    matePos: parsed.matePos,
    mateOrientation: parsed.mateOrientation,
    event: fields.info['EVENT'],
    jcn: fields.info['JCN'] ? Number(fields.info['JCN']) : undefined,
    jcnUncertainty: fields.info['JCNUNCERT']
      ? Number(fields.info['JCNUNCERT'])
      : undefined,
  }
}

export function parseVcfLines(lines: string[]): Breakend[] {
  const breakends: Breakend[] = []

  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') {
      continue
    }
    const cols = line.split('\t')
    const chrom = cols[0]!
    const pos = Number(cols[1]!)
    const id = cols[2]!
    const alt = cols[4]!
    const infoStr = cols[7] ?? ''

    const info: Record<string, string | undefined> = {}
    for (const part of infoStr.split(';')) {
      const eq = part.indexOf('=')
      if (eq >= 0) {
        info[part.slice(0, eq)] = part.slice(eq + 1)
      }
    }

    if (info['SVTYPE'] !== 'BND') {
      continue
    }

    const breakend = parseBreakendRecord({ chrom, pos, id, alt, info })
    if (breakend) {
      breakends.push(breakend)
    }
  }

  return breakends
}
