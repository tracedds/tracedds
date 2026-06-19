// Decode a fetched response body to text using the page's real character set.
//
// `Response.text()` always decodes as UTF-8 unless the Content-Type header names
// another charset. Several supplier sites serve Windows-1252 without declaring
// it (or mislabel it as UTF-8), so bytes like 0x99 (™) and 0xAE (®) are invalid
// UTF-8 and get turned into the replacement character U+FFFD — that is the
// `Calset<U+FFFD>` corruption seen in product names. We pick the charset from the
// header, then the page's own <meta charset>, defaulting to UTF-8, and fall back
// to Windows-1252 when a UTF-8 decode still produces replacement characters.

const CHARSET_ALIASES: Record<string, string> = {
  utf8: "utf-8",
  "utf-8": "utf-8",
  ascii: "utf-8",
  "us-ascii": "utf-8",
  latin1: "windows-1252",
  "latin-1": "windows-1252",
  "iso-8859-1": "windows-1252",
  "iso8859-1": "windows-1252",
  "iso_8859-1": "windows-1252",
  cp1252: "windows-1252",
  "windows-1252": "windows-1252",
}

function canonicalCharset(label: string): string {
  const key = label.trim().toLowerCase()
  return CHARSET_ALIASES[key] ?? key
}

function charsetFromContentType(contentType: string | null): string {
  const match = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(contentType ?? "")
  return match ? canonicalCharset(match[1]) : ""
}

function charsetFromMeta(head: string): string {
  const meta = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)
  if (meta) return canonicalCharset(meta[1])
  const httpEquiv = /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+)/i.exec(head)
  return httpEquiv ? canonicalCharset(httpEquiv[1]) : ""
}

function countReplacementChars(value: string): number {
  let count = 0
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) === 0xfffd) count++
  }
  return count
}

export function decodeBody(bytes: ArrayBuffer | Uint8Array, contentType: string | null): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)

  let charset = charsetFromContentType(contentType)
  if (!charset) {
    // Sniff the document head (latin1 keeps every byte 1:1 so the regex matches).
    const head = Buffer.from(buf.slice(0, 2048)).toString("latin1")
    charset = charsetFromMeta(head)
  }
  if (!charset) charset = "utf-8"

  let text: string
  try {
    text = new TextDecoder(charset, { fatal: false }).decode(buf)
  } catch {
    // Unknown label — fall back to UTF-8 and let the recovery pass below run.
    charset = "utf-8"
    text = new TextDecoder("utf-8", { fatal: false }).decode(buf)
  }

  // A UTF-8 decode that produced replacement characters is almost always a
  // mislabeled Windows-1252 page; windows-1252 maps every byte, so retry and
  // keep it only if it actually has fewer replacement characters.
  if (charset === "utf-8" && text.includes("\uFFFD")) {
    const retry = new TextDecoder("windows-1252", { fatal: false }).decode(buf)
    if (countReplacementChars(retry) < countReplacementChars(text)) {
      text = retry
    }
  }

  return text
}
