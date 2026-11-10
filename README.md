# fishvar

Takes a human ClinVar missense variant, finds the orthologous codon in zebrafish, works out which single base change is needed *there*, and designs Umax base-editing guides for it.

This is the front half of the pipeline that [`umax-guide-designer`](https://github.com/thevarshneylab/umax-guide-designer) doesn't cover. That tool needs a sequence and a target base; this one produces them from a variant ID.

Real output, from the offline test fixtures — reproduce it with `npm run demo`:

```
$ fishvar TESTA:p.Arg100His --cache-dir ./fixtures --cache-only --top 3

==============================================================================
TESTA:p.Arg100His
  human TESTA p.R100H   (missense)
  verdict: designed
==============================================================================

Orthologues examined: 3, residue conserved in 1 (gene is duplicated in zebrafish)

  zebrafish gene        type                %id   residue  status
  --------------------------------------------------------------------------
  ENSDARG00000000001    one2many            68.4  R90      conserved
  ENSDARG00000000002    one2many            54.1  K90      not_conserved
      zebrafish carries K at the orthologous position, not R
  ENSDARG00000000003    one2many            41.0  -        no_aligned_residue
      the human residue falls in a gap in the zebrafish alignment (indel or
      missing domain)

------------------------------------------------------------------------------
ENSDARG00000000001   7:1000000-1000002 (+)   ENSDART00000000001
  target: R90 -> H   codon CGC   identity 68% global, 100% local

  CGC > CAC   (G>A at codon position 2)   CBE on the - strand   [intended product]

    score  editor                str  spacer (5'->3')        PAM   pos  bystanders
    ----------------------------------------------------------------------
    55     TCBE-Umax             -    ACGCGTGAGTTCAGGATACC   TGG   4    none
    53     TCBE-Umax-ex1         -    ACGCGTGAGTTCAGGATACC   TGG   4    1: L87= (silent)
    50     TCBE-Umax-rest2       -    ACGCGTGAGTTCAGGATACC   TGG   4    none
    ... 14 more (use --top or --format json)

  genomic context, coding orientation, target codon at offset 45:
    ATGGCTAGCCTGGAAAAGGTCACCTTCCCAGGTATCCTGAACTCACGCGTGAAGCTTGACATGTCCAAGCTGACCTTCGGACAGATCCTGAAC
```

Note the residue offset: human 100 maps to zebrafish 90 across a ten-residue
gap in the alignment. Assuming shared numbering is the easiest way to get this
wrong, so the fixtures are built with a deliberate offset.

## Why it isn't just a coordinate lookup

The human variant's own nucleotide change cannot be reused. A human `c.G>A` giving p.Arg→His says nothing about what zebrafish needs, because the orthologous arginine may sit on a different synonymous codon. Only two of the six arginine codons can reach histidine by any single substitution at all:

```
CGC → CAC  ✓      CGA ✗   CGG ✗
CGT → CAT  ✓      AGA ✗   AGG ✗
```

So the tool fetches the actual zebrafish codon, enumerates the single-base changes that would produce the target residue, and checks each against what Umax chemistry can install. Because editors act on whichever strand the guide anneals to, each chemistry covers two changes on the reference strand:

| Chemistry | Sense-strand change | Antisense-strand change |
|---|---|---|
| ABE-Umax (A→G) | `A>G` | `T>C` |
| TCBE-Umax (C→T) | `C>T` | `G>A` |
| zAYE (A→C / A→T) | `A>C`, `A>T` | `T>G`, `T>A` |

That is 8 of the 12 possible substitutions. **`C>A`, `C>G`, `G>C` and `G>T` cannot be installed by any Umax editor**, so a variant needing one of those is reported as unreachable rather than designed around. The palette is derived at runtime from `UMAX.FAMILY`, so adding a chemistry to the engine widens it here automatically.

`npm run coverage` reports how much of the substitution space that buys, as a ceiling on chemistry alone — before conservation, PAM availability or window placement:

```
  palette                   missense   nonsense
  ------------------------------------------------
  ABE only                   16.4%       0.0%
  CBE only                   16.4%      22.2%
  AYE only                   49.4%      38.9%
  ABE + CBE                  32.8%      22.2%
  ABE + CBE + AYE            65.8%      61.1%
```

The ABE+CBE row is a useful sanity check: it lands close to the ~30% of ClinVar that ACEofBASEs reported as accessible with a standard window and NGG PAM. The transversion editors roughly double it. The same script lists the 41 substitution classes that are reachable by one base change but never by this palette — `G>A`/`G>C`/`G>V`/`G>W` (the collagenopathy glycine substitutions), `R>P/L/I/M/T`, `P>A/H/Q/R/T` and others worth surfacing in a UI as hard refusals.

## Install

```bash
git clone <this repo> && cd fishvar
npm test          # builds fixtures and runs the suite offline
```

No runtime dependencies. Node 18+ (uses global `fetch`).

The guide engine is vendored in `vendor/` (`umax.js`, `editors.json`, and `UMAX_COMMIT` recording the upstream commit). To track a newer upstream, point `--umax-path` at a checkout:

```bash
fishvar VCV000012345 --umax-path ../umax-guide-designer
```

`editors.json` is validated with the engine's own `validateEditors` on every run, so a malformed registry fails immediately rather than producing quiet nonsense.

## Usage

```bash
fishvar VCV000012345                     # ClinVar accession
fishvar rs80338939                        # rsID (rejected if it maps to several records)
fishvar MYO7A:p.Arg302His                 # direct, skips ClinVar entirely
fishvar --batch variants.txt --format csv > designs.csv
```

| Option | Meaning |
|---|---|
| `--format text\|json\|csv` | `text` to read, `json` for everything, `csv` one row per guide |
| `--top N` | guides shown per edit in text output (default 5) |
| `--batch FILE` | one variant per line, `#` comments allowed |
| `--cache-dir DIR` | cache API responses (default `.fishvar-cache`) |
| `--cache-only` | never touch the network; fail on a cache miss |
| `--umax-path DIR` | checkout of `umax-guide-designer` |
| `--include-untested` | include predicted editor/backbone pairings |
| `--max-paralogs N` | conserved orthologues to design against (default 4) |
| `--ncbi-api-key KEY` | raises the NCBI rate limit (or `NCBI_API_KEY`) |

Every response is cached. That is a reproducibility feature, not just a speed one: a design that went into an injection can be re-derived months later from the same data with `--cache-only`, even after an Ensembl release has moved.

## How it works

1. **ClinVar** — E-utilities `esearch` + `esummary` give the gene, the HGVS protein change and the classification.
2. **Orthology** — one Ensembl REST call returns the Compara protein alignment with `align_seq` for both species, so residue-to-residue mapping needs no local aligner.
3. **Residue mapping** — the human residue's alignment column is read off, then converted to a zebrafish residue number.
4. **Codon retrieval** — `/map/translation` gives the codon's genomic coordinates; the region is fetched with an explicit strand so the sequence comes back already in coding orientation.
5. **Required edit** — the codon is compared against the target residue and filtered through the palette.
6. **Guide design** — handed to the vendored engine's `design()`.

Guide finding, scoring and protein-consequence calling are **not** reimplemented here. They are called out to `umax.js`, so there is one implementation of the ranking heuristic and the two tools cannot drift apart.

## The checks that carry the weight

**Isoform agreement.** A ClinVar `p.` change is numbered against a RefSeq protein; the Compara alignment is numbered against Ensembl canonical. These can disagree. If the human residue at the mapped column isn't the wild-type residue ClinVar reported, the variant is rejected as `isoform_mismatch` rather than designed against — a silent numbering error would otherwise produce a confident, wrong guide.

**Conservation.** Modelling a substitution only means something if zebrafish carries the same wild-type residue. Non-conserved positions are reported with what zebrafish has instead.

**Codon agreement.** The genomic codon must encode the residue the alignment promised. If the protein, the assembly and the alignment disagree, the position is refused.

**Split codons.** A codon straddling an exon junction has non-contiguous genomic bases; a continuous window there would contain intronic sequence and any guide built on it would be wrong. v1 refuses these.

**Exon junctions in the protospacer.** A guide reaching past an exon boundary is flagged. The on-target consequence is still correct, but bystander calls assume a continuous reading frame and are not reliable there.

**Paralogues.** Teleost whole-genome duplication leaves many human genes with two zebrafish co-orthologues. All candidates are reported with their identity and conservation status, and a redundancy warning is raised when the residue is conserved in more than one — whether to edit one or both is an experimental design decision the tool informs rather than makes.

## Verdicts

| Status | Meaning |
|---|---|
| `ok` | at least one guide designed |
| `not_modelable` | residue not conserved in any zebrafish orthologue |
| `isoform_mismatch` | ClinVar and Ensembl numbering disagree; check the transcript |
| `unsupported_consequence` | not a missense SNV (see scope below) |
| `no_ortholog` | Compara reports no zebrafish orthologue with a protein alignment |
| `no_design` | mapped successfully, but nothing could be built |

Per-orthologue, `no_design` resolves further to `blocked_by_chemistry` (the change is outside the Umax palette), `blocked_by_genetic_code` (no single substitution reaches that residue from this codon, whatever the chemistry — the report names the synonymous codons that would have worked), `no_context`, `codon_mismatch` or `no_guides`.

A variant that is legitimately unmodelable exits 0. "Not conserved in zebrafish" is an answer, not a failure.

## Scope and limitations

- **Missense SNVs only.** Truncating, splice and non-coding variants are reported as out of scope. For a truncating variant the useful zebrafish model is usually a CBE-installed premature stop anywhere in a suitable codon (`CGA>TGA`, `CAA>TAA`, `CAG>TAG`, `TGG>TGA/TAG`), which ignores residue mapping entirely and is a different code path.
- **No off-target search.** Inherited from the upstream tool. Run candidate spacers through CRISPOR or Cas-OFFinder against *Danio rerio* GRCz11.
- **No efficiency prediction.** The score is a triage heuristic from the upstream engine, not a trained model; published models were not trained on zebrafish embryos.
- **Ensembl canonical transcript only.** No isoform selection.
- **Compara orthology only.** Worth cross-checking contested calls against ZFIN `human_orthos.txt`, which is the curated authority for zebrafish-human orthology.
- **Transversion editor parameters are unpublished** and may change before publication; guides from the zAYE family carry a flag, as do predicted editor/backbone pairings.

## Testing

```bash
npm test
```

100 checks, entirely offline. Fixtures are written into the HTTP cache under the exact filenames the client would use, so the suite exercises the real code path including URL construction — a wrongly built URL fails as a cache miss.

The suite re-derives the top guide's spacer and PAM from the context sequence independently of `umax.js`, applies the edit and confirms the resulting codon, and checks that the palette and the engine agree about guide strand for every route. Coverage includes the conserved, non-conserved, alignment-gap, split-codon, exon-junction, isoform-mismatch, unreachable-codon and truncating-variant cases.

> [!IMPORTANT]
> The test suite is fixture-based and the fixtures are synthetic. The live
> ClinVar and Ensembl endpoints have **not** been exercised against real
> records yet, so run a smoke test on a known variant before trusting a batch:
>
> ```bash
> fishvar MYO7A:p.Arg302His --format json | head -40
> ```
>
> Check that the zebrafish residue, codon and locus are what you expect in
> Ensembl before using any spacer.

## Citing

The editors and their parameters are from:

> Qin W, Liang F, Lin S-J, et al. ABE-ultramax for high-efficiency biallelic adenine base editing in zebrafish. *Nat Commun*. 2024;15:5613. doi:10.1038/s41467-024-49943-1

> Qin W, Lin S-J, Zhang Y, et al. High-efficiency TadA cytosine base editors for precise modelling of human disease variants. *Nat Biomed Eng*. 2026. doi:10.1038/s41551-025-01607-1

Adenine transversion editors are from a manuscript in preparation (Qin W, Zhang Y, Huang K, Varshney GK).
