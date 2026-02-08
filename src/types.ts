export interface Breakend {
  id: string
  chr: string
  pos: number
  // +1 = faces right (sequence continues rightward from this position)
  // -1 = faces left (sequence continues leftward from this position)
  orientation: 1 | -1
  mateId: string | undefined
  mateChr: string | undefined
  matePos: number | undefined
  mateOrientation: (1 | -1) | undefined
  event: string | undefined
  jcn?: number
  jcnUncertainty?: number
}

export interface CopyNumberSegment {
  chr: string
  start: number
  end: number
  majorAlleleCN: number
  minorAlleleCN: number
}

export interface DerivativeChromosome {
  chains: Chain[]
}

export interface Chain {
  segments: ChainSegment[]
  jcn?: number
  openStart: Breakend | null
  openEnd: Breakend | null
  isClosed: boolean
}

export interface ChainSegment {
  chr: string
  start: number
  end: number
  orientation: 'forward' | 'reverse'
}

export type LinkType =
  | 'ASSEMBLY'
  | 'ONLY'
  | 'ADJACENT'
  | 'JCN_MATCH'
  | 'NEAREST'

export interface Link {
  type: 'SV' | 'TI' | 'DB'
  breakend1: Breakend
  breakend2: Breakend
  priority?: LinkType
}

export interface BreakendGraph {
  breakends: Breakend[]
  svLinks: Link[]
  tiLinks: Link[]
  dbLinks: Link[]
}

export interface Cluster {
  id: string
  breakends: Breakend[]
  event?: string
}

export type SVClass =
  | 'DEL'
  | 'DUP'
  | 'INV'
  | 'TRA'
  | 'COMPLEX'
  | 'UNKNOWN'
