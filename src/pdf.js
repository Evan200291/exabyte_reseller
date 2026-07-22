// Minimal, zero-dependency PDF writer used to export the product list.
// Produces a valid PDF/1.4 document with monospaced text laid out in rows.

const PAGE_WIDTH = 595;   // A4 width in points
const PAGE_HEIGHT = 842;  // A4 height in points
const MARGIN_X = 36;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 40;
const FONT_SIZE = 9;
const LINE_HEIGHT = 12;

function escapeText(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    // Strip characters that WinAnsi/Helvetica cannot render (emojis, non-latin)
    .replace(/[^\x20-\x7E]/g, "");
}

function wrap(text, maxChars) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    const attempt = current ? `${current} ${word}` : word;
    if (attempt.length > maxChars) {
      if (current) lines.push(current);
      // Handle words longer than maxChars by hard-cutting
      let long = word;
      while (long.length > maxChars) {
        lines.push(long.slice(0, maxChars));
        long = long.slice(maxChars);
      }
      current = long;
    } else {
      current = attempt;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function padRight(text, width) {
  const clean = String(text ?? "");
  if (clean.length >= width) return clean.slice(0, width);
  return clean + " ".repeat(width - clean.length);
}

function padLeft(text, width) {
  const clean = String(text ?? "");
  if (clean.length >= width) return clean.slice(0, width);
  return " ".repeat(width - clean.length) + clean;
}

// sections: [{ title, rows }] — each section gets a bold title line before its rows.
// If no sections given, falls back to flat rows array.
// columns: [{ header, width, align }] where widths sum ~= 78 monospaced chars
export function buildProductListPdf({ title, subtitle, generatedAt, columns, rows, sections, footer }) {
  const linesPerPage = Math.floor((PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM) / LINE_HEIGHT);

  const pages = [];
  let current = [];

  const formatRow = (values) => {
    const cells = columns.map((col, idx) => {
      const raw = escapeText(values[idx] ?? "");
      return col.align === "right" ? padLeft(raw, col.width) : padRight(raw, col.width);
    });
    return cells.join(" ");
  };

  const pushLine = (line) => {
    if (current.length >= linesPerPage - 4) { pages.push(current); current = []; }
    current.push(line);
  };

  const pushHeader = () => {
    current.push(escapeText(title));
    if (subtitle) current.push(escapeText(subtitle));
    current.push(escapeText(`Generated: ${generatedAt} (UTC 00:00)`));
    current.push("");
    current.push(formatRow(columns.map((c) => c.header)));
    current.push("-".repeat(columns.reduce((sum, c) => sum + c.width + 1, 0)));
  };

  const pushRows = (dataRows) => {
    for (const row of dataRows) {
      const wrappedCells = columns.map((col, idx) => wrap(String(row[idx] ?? ""), col.width));
      const lineCount = Math.max(1, ...wrappedCells.map((cell) => cell.length));
      for (let line = 0; line < lineCount; line++) {
        const values = wrappedCells.map((cell) => cell[line] || "");
        pushLine(formatRow(values));
      }
    }
  };

  pushHeader();

  if (sections && sections.length) {
    for (const section of sections) {
      pushLine("");
      pushLine(`=== ${escapeText(section.title)} ===`);
      pushLine("");
      pushRows(section.rows);
    }
  } else if (rows) {
    pushRows(rows);
  }

  if (footer) { pushLine(""); pushLine(escapeText(footer)); }
  if (current.length) pages.push(current);

  return renderPdf(pages);
}

function renderPdf(pages) {
  const objects = [];
  const pushObj = (body) => { objects.push(body); return objects.length; };

  const catalogRef = objects.length + 1;
  const pagesRef = objects.length + 2;
  objects.push(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
  objects.push(""); // Placeholder for /Pages, filled after page objects exist

  const fontRef = objects.length + 1;
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`);
  const fontBoldRef = objects.length + 1;
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>`);

  const pageRefs = [];
  for (const lines of pages) {
    const contentStream = buildContent(lines);
    const contentRef = pushObj(`<< /Length ${Buffer.byteLength(contentStream, "latin1")} >>\nstream\n${contentStream}\nendstream`);
    const pageRef = pushObj(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentRef} 0 R /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${fontBoldRef} 0 R >> >> >>`);
    pageRefs.push(pageRef);
  }

  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;

  return assemble(objects, catalogRef);
}

function buildContent(lines) {
  const parts = ["BT", `/F1 ${FONT_SIZE} Tf`, `${LINE_HEIGHT} TL`, `${MARGIN_X} ${PAGE_HEIGHT - MARGIN_TOP} Td`];
  lines.forEach((line, index) => {
    if (index === 0) parts.push(`(${line}) Tj`);
    else parts.push(`T* (${line}) Tj`);
  });
  parts.push("ET");
  return parts.join("\n");
}

function assemble(objects, catalogRef) {
  let output = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "latin1");
}
