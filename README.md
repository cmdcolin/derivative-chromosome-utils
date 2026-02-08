# derivative-chromosome-utils

Reconstruct derivative chromosomes from VCF breakend (BND) records.

## Overview

This library takes BND records from any VCF and reconstructs derivative
chromosomes by building a breakend graph and chaining breakend pairs into
ordered sequences of reference segments.

The algorithm is adapted from the LINX chaining approach (Hartwig Medical
Foundation) but decoupled from any specific SV caller.

## Visualizations

The diagrams below show how breakend pairs define structural variants.
Triangles indicate breakend orientation (+1 green = faces right, -1 red =
faces left). Dashed arcs connect mate pairs.

### Deletion

Two breakends face inward — the reference segment between them is lost.

![Deletion](img/deletion.png)

### Inversion

Two breakends face the same direction — the segment between them is reversed.

![Inversion](img/inversion.png)

### Translocation

Breakends on different chromosomes — sequence from one chromosome joins
another.

![Translocation](img/translocation.png)

### Complex rearrangement

Multiple breakend pairs across chromosomes form a multi-breakpoint chain.

![Complex](img/complex.png)

To regenerate these images:

```bash
node --experimental-strip-types scripts/visualize.ts
```

## Three tiers

1. **Simple pairing** — Parse BND records, match mates, build chains from SV
   junctions. Handles DEL, DUP, INV, TRA.
2. **Clustering heuristics** — Proximity-based clustering, facing-breakend
   detection, link prioritization (ONLY > ADJACENT > JCN_MATCH > NEAREST).
3. **Copy number constraints** — Accept copy number segments, filter links
   crossing zero-JCN boundaries, use JCN matching for prioritization.

## Usage

```ts
import { parseVcfLines, deriveChromosomes, classifyChain } from 'derivative-chromosome-utils'

const lines = fs.readFileSync('variants.vcf', 'utf-8').split('\n')
const breakends = parseVcfLines(lines)
const result = deriveChromosomes(breakends)

for (const chain of result.chains) {
  console.log(classifyChain(chain), chain.segments)
}
```

With copy number data:

```ts
const result = deriveChromosomes(breakends, {
  cnSegments: [
    { chr: 'chr1', start: 0, end: 50000000, majorAlleleCN: 2, minorAlleleCN: 1 },
  ],
})
```

## Tests

```bash
npm test
```
