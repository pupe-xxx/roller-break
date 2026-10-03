// 六角形の盤の座標。ルールのどこからでも使う。
// マスは (q, r) の2つの数で表す。盤の中心が (0, 0)。

export type Hex = readonly [q: number, r: number];

/** 隣の6方向。番号（0〜5）がそのまま「向き」になる */
export const DIRS: readonly Hex[] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const keyOf = (q: number, r: number): string => `${q},${r}`;

export function hexOf(key: string): Hex {
  const [q, r] = key.split(',').map(Number);
  return [q, r];
}

export function inBoard(q: number, r: number, radius: number): boolean {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius;
}

/** 盤のすべてのマス。上の段から、左から右へ */
export function boardCells(radius: number): Hex[] {
  const cells: Hex[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (inBoard(q, r, radius)) cells.push([q, r]);
    }
  }
  return cells;
}

export function hexDist(a: Hex, b: Hex): number {
  const dq = a[0] - b[0], dr = a[1] - b[1];
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** from から見て to がまっすぐ6方向のどれかにあれば、その向き。無ければ -1 */
export function dirTo(from: Hex, to: Hex): number {
  const dq = to[0] - from[0], dr = to[1] - from[1];
  if (dq === 0 && dr === 0) return -1;
  if (dq !== 0 && dr !== 0 && dq + dr !== 0) return -1;
  return DIRS.findIndex(([q, r]) => q === Math.sign(dq) && r === Math.sign(dr));
}
