/** Just enough CSV parsing to show a preview and brief the agent. Pandas does the real work. */
export function inspectCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) throw new Error("The CSV needs a header row and at least one data row.");
  const columns = parseLine(lines[0]);
  if (columns.length < 2) throw new Error("That doesn't look like a CSV: no commas in the header row.");
  return {
    columns,
    previewRows: lines.slice(1, 6).map(parseLine),
    rowCount: lines.length - 1,
    head: lines.slice(0, 6).join("\n"),
  };
}

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}
