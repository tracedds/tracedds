// Read-only proof of pack-parser coverage against a real prod sample.
// Usage: PACK_SAMPLE_CSV=/tmp/pack-sample.csv ts-node ./src/scripts/validate-pack-parsing.ts
import { readFileSync } from "fs"
import { parsePack, type PackParseResult } from "../ingestion/pack"

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ""
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = "" }
    else if (c !== "\r") field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.length >= 2)
}

const file = process.env.PACK_SAMPLE_CSV || "/tmp/pack-sample.csv"
const rows = parseCsv(readFileSync(file, "utf8"))

let total = 0
let parsed = 0
const bySource: Record<string, number> = { pack_size: 0, name: 0, none: 0 }
const byBasis: Record<string, number> = {}
const hasPack = { count: 0, parsed: 0 }
const noPack = { count: 0, parsed: 0 }
const fromNameSamples: string[] = []
const missedSamples: string[] = []

for (const [packSize, name, category] of rows) {
  total++
  const r: PackParseResult = parsePack(packSize, name, category)
  if (r.pack_quantity !== null) parsed++
  bySource[r.source] = (bySource[r.source] || 0) + 1
  byBasis[r.basis] = (byBasis[r.basis] || 0) + 1

  if (packSize.trim()) {
    hasPack.count++
    if (r.pack_quantity !== null) hasPack.parsed++
  } else {
    noPack.count++
    if (r.pack_quantity !== null) noPack.parsed++
  }

  if (r.source === "name" && fromNameSamples.length < 12) {
    fromNameSamples.push(`  ${r.pack_quantity} ${r.base_unit} [${r.basis} conf=${r.confidence}]  <- "${name.slice(0, 52)}"`)
  }
  // Rows with no pack_size AND no parse, but whose name contains a digit+unit hint we may have missed.
  if (r.pack_quantity === null && /\d\s*(\/|ml|\bg\b|ct|count|pk|box|pack|bag|case)/i.test(name) && missedSamples.length < 12) {
    missedSamples.push(`  ps="${packSize}" name="${name.slice(0, 60)}"`)
  }
}

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a")

console.log(`\n=== Pack-parser coverage on ${total} random prod rows ===`)
console.log(`Parsed (pack_quantity found): ${parsed} (${pct(parsed, total)})`)
console.log(`\nBy source:`)
console.log(`  from pack_size: ${bySource.pack_size} (${pct(bySource.pack_size, total)})`)
console.log(`  from name:      ${bySource.name} (${pct(bySource.name, total)})`)
console.log(`  unresolved:     ${bySource.none} (${pct(bySource.none, total)})`)
console.log(`\nSplit by whether pack_size exists:`)
console.log(`  has pack_size: ${hasPack.count} rows, parsed ${hasPack.parsed} (${pct(hasPack.parsed, hasPack.count)})`)
console.log(`  no  pack_size: ${noPack.count} rows, recovered from name ${noPack.parsed} (${pct(noPack.parsed, noPack.count)})`)
console.log(`\nBy basis:`)
for (const [b, c] of Object.entries(byBasis).sort((a, b2) => b2[1] - a[1])) {
  console.log(`  ${b}: ${c} (${pct(c, total)})`)
}
console.log(`\nSample recoveries from NAME (eyeball accuracy):`)
console.log(fromNameSamples.join("\n"))
console.log(`\nUnresolved rows whose name hints at a pack we may be missing:`)
console.log(missedSamples.join("\n") || "  (none)")
