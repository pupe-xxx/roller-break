// 六角形の盤を描くための座標の計算。描画はすべて論理サイズの座標で書く。
import type { Hex } from '../game/hex';

export interface HexLayout {
  /** 六角形の中心から角までの長さ */
  size: number;
  /** 盤の中心（マス 0,0）の位置 */
  cx: number;
  cy: number;
}

const SQRT3 = Math.sqrt(3);

/** 半径 radius の盤が、area の中に余白 margin を残して収まる大きさを求める */
export function layoutFor(radius: number, area: { x: number; y: number; width: number; height: number }, margin: number = 28): HexLayout {
  const size = Math.min((area.width - margin * 2) / (SQRT3 * (2 * radius + 1)), (area.height - margin * 2) / (3 * radius + 2));
  return { size, cx: area.x + area.width / 2, cy: area.y + area.height / 2 };
}

export function centerOf(layout: HexLayout, [q, r]: Hex): { x: number; y: number } {
  return { x: layout.cx + layout.size * SQRT3 * (q + r / 2), y: layout.cy + layout.size * 1.5 * r };
}

/** 論理サイズの座標 → その位置のマス（盤の外のマスも返す） */
export function hexAt(layout: HexLayout, x: number, y: number): Hex {
  const px = (x - layout.cx) / layout.size, py = (y - layout.cy) / layout.size;
  const fq = (SQRT3 / 3) * px - py / 3, fr = (2 / 3) * py, fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

/** 六角形の輪郭をパスにする。scale で少し小さく描ける */
export function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, scale: number = 1): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const px = x + size * scale * Math.cos(angle), py = y + size * scale * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
