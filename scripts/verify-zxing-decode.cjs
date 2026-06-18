// Headless proof that @zxing/library decodes the exact UPC-A barcodes we print
// for the scanner (the iOS camera-fallback path). We encode real DC Dental test
// codes into a UPC-A module image and run the same multi-format reader the
// fallback uses. Run: node scripts/verify-zxing-decode.cjs
const {
  BarcodeFormat,
  DecodeHintType,
  MultiFormatReader,
  RGBLuminanceSource,
  HybridBinarizer,
  BinaryBitmap,
} = require("@zxing/library");

// Real DC Dental UPC-A test codes (scripts/gen-test-barcodes.py).
const CODES = [
  "354227064216",
  "133757658177",
  "556268357771",
  "513324144829",
  "441887758811",
  "143673500269",
];

// Standard UPC-A left (odd-parity) digit patterns; right patterns are the complement.
const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const R = L.map((p) => p.split("").map((b) => (b === "1" ? "0" : "1")).join(""));

function modules(code) {
  const d = code.split("").map(Number);
  let bits = "0".repeat(9) + "101"; // left quiet zone + start guard
  for (let i = 0; i < 6; i++) bits += L[d[i]];
  bits += "01010"; // center guard
  for (let i = 6; i < 12; i++) bits += R[d[i]];
  bits += "101" + "0".repeat(9); // end guard + right quiet zone
  return bits;
}

function render(code) {
  const scale = 4;
  const bits = modules(code);
  const w = bits.length * scale;
  const h = 40;
  const luma = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      luma[y * w + x] = bits[Math.floor(x / scale)] === "1" ? 0 : 255; // bar -> 0
    }
  }
  return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luma, w, h)));
}

const reader = new MultiFormatReader();
reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.UPC_A, BarcodeFormat.EAN_13]]]));

let pass = 0;
for (const code of CODES) {
  try {
    const text = reader.decode(render(code)).getText();
    const ok = text === code;
    pass += ok ? 1 : 0;
    console.log(`${ok ? "PASS" : "FAIL"}  printed ${code} -> decoded ${text}`);
  } catch (e) {
    console.log(`FAIL  printed ${code} -> NO DECODE (${e.name || e.message})`);
  }
  reader.reset();
}
console.log(`\n${pass}/${CODES.length} decoded`);
process.exit(pass === CODES.length ? 0 : 1);
