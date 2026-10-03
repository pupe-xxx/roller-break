import { SIZE, type State } from '../game/rules';

// 論理サイズ。描画はすべてこの座標で書く（実際の大きさは kit/scale が合わせる）
export const VIEW = { width: 720, height: 720 } as const;

const CELL = VIEW.width / SIZE;
const COLORS = { bg: '#101a28', grid: '#3d6090', p1: '#4fc3f7', p2: '#ef5350' } as const;

export function draw(ctx: CanvasRenderingContext2D, state: State): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (let i = 1; i < SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL, 20);
    ctx.lineTo(i * CELL, VIEW.height - 20);
    ctx.moveTo(20, i * CELL);
    ctx.lineTo(VIEW.width - 20, i * CELL);
    ctx.stroke();
  }

  state.board.forEach((cell, i) => {
    if (!cell) return;
    const cx = (i % SIZE) * CELL + CELL / 2;
    const cy = Math.floor(i / SIZE) * CELL + CELL / 2;
    const r = CELL * 0.28;
    ctx.strokeStyle = COLORS[cell];
    ctx.lineWidth = 14;
    ctx.beginPath();
    if (cell === 'p1') {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else {
      ctx.moveTo(cx - r, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r);
      ctx.lineTo(cx - r, cy + r);
    }
    ctx.stroke();
  });
}

/** 論理サイズの座標 → マスの番号 */
export function cellAt(x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= VIEW.width || y >= VIEW.height) return null;
  return Math.floor(y / CELL) * SIZE + Math.floor(x / CELL);
}
