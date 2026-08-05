const fs = require("fs");
const path = require("path");

async function main() {
  // Dynamic import for pdfjs-dist (ESM-compatible)
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const pdfPath = path.join(__dirname, "..", "..", "Suhan_Gautam_Resume_2026 (3) (1).pdf");
  const dataBuffer = new Uint8Array(fs.readFileSync(pdfPath));

  const doc = await pdfjsLib.getDocument({ data: dataBuffer }).promise;
  let fullText = "";

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    fullText += pageText + "\n\n";
  }

  const outPath = path.join(__dirname, "..", "master_resume.txt");
  fs.writeFileSync(outPath, fullText.trim(), "utf-8");
  console.log("Extracted", fullText.length, "chars to", outPath);
  console.log("---PREVIEW (first 600 chars)---");
  console.log(fullText.substring(0, 600));
}
main().catch(console.error);
