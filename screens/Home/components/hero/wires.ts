// The HTML figure's connectors: a curve from a proving CV line to its requirement, measured from the layout.

export type Box = { left: number; right: number; top: number; bottom: number };
export type Wire = { id: string; d: string };

const at = (n: number) => n.toFixed(1);
const middle = (b: Box) => (b.top + b.bottom) / 2;

/**
 * The path, in the figure's own coordinates (origin = its top left). Stacked sheets (phones): the curve leaves both
 * left edges and bows into the gutter on the left. Side by side (the CV to the right): it crosses the gap between them.
 */
export function wirePath(origin: { left: number; top: number }, sheet: Box, cv: Box, row: Box, line: Box): string {
  const fromY = middle(line) - origin.top;
  const toY = middle(row) - origin.top;
  const fromX = cv.left - origin.left - 1;
  if (cv.left >= sheet.right) {
    const toX = sheet.right - origin.left + 1;
    const mid = (fromX + toX) / 2;
    return `M ${at(fromX)} ${at(fromY)} C ${at(mid)} ${at(fromY)}, ${at(mid)} ${at(toY)}, ${at(toX)} ${at(toY)}`;
  }
  const toX = sheet.left - origin.left - 1;
  const bow = Math.min(fromX, toX) - 18;
  return `M ${at(fromX)} ${at(fromY)} C ${at(bow)} ${at(fromY)}, ${at(bow)} ${at(toY)}, ${at(toX)} ${at(toY)}`;
}
