// このゲームの画面。盤を描き、タップを発射に直して、外枠（shell）に渡す。
import { DIRS, boardCells, dirTo, hexOf, inBoard, keyOf, type Hex } from '../game/hex';
import { LEVELS } from '../game/levels';
import { createState, fire, starsOf, type ShotResult, type State, type TireKind } from '../game/rules';
import { centerOf, hexAt, hexPath, layoutFor, type HexLayout } from './hexview';
import { t } from './i18n';
import type { Anim, GameDef } from './shell';

// 論理サイズ。描画はすべてこの座標で書く（実際の大きさは kit/scale が合わせる）
const VIEW = { width: 720, height: 720 } as const;
const COLORS = {
  bg: '#0a111b', cell: '#1c2e45', cellAlt: '#152236', grid: '#2a4060', aim: 'rgba(255,138,80,0.16)',
  wall: '#546e7a', wall2: '#90a4ae', target: '#ef5350', targetRing: '#ffebee',
  roller: '#ff8a50', rollerDark: '#3e2416', select: '#ffe082', tire: '#263238',
} as const;

const HINTS: [ja: string, en: string][] = [
  ['転師のまっすぐ先をタップすると、タイヤが転がる', 'Tap a cell in a straight line from the roller to launch a tire'],
  ['壁は1発で1段削れる。先に壁をどかそう', 'A tire chips one layer off a wall. Clear the wall first'],
  ['重いタイヤは的を貫いて進む', 'A heavy tire rolls straight through targets'],
];

let levelIndex = 0;
let selected = 0;
let kind: TireKind = 'light';

const layoutOf = (state: State): HexLayout => layoutFor(state.radius, { x: 0, y: 0, ...VIEW });

function drawBoard(ctx: CanvasRenderingContext2D, layout: HexLayout, state: State): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  for (const [q, r] of boardCells(state.radius)) {
    const { x, y } = centerOf(layout, [q, r]);
    hexPath(ctx, x, y, layout.size, 0.96);
    ctx.fillStyle = ((q - r) % 3 + 3) % 3 === 0 ? COLORS.cellAlt : COLORS.cell;
    ctx.fill();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** 選んでいる転師から撃てる6本の線を、うっすら見せる */
function drawAim(ctx: CanvasRenderingContext2D, layout: HexLayout, state: State): void {
  const from = state.rollers[selected];
  if (from === undefined) return;
  const [fq, fr] = hexOf(from);
  ctx.fillStyle = COLORS.aim;
  for (const [dq, dr] of DIRS) {
    for (let q = fq + dq, r = fr + dr; inBoard(q, r, state.radius); q += dq, r += dr) {
      const { x, y } = centerOf(layout, [q, r]);
      hexPath(ctx, x, y, layout.size, 0.96);
      ctx.fill();
    }
  }
}

function drawWall(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, stage: number): void {
  const { x, y } = centerOf(layout, cell);
  hexPath(ctx, x, y, layout.size, 0.84);
  ctx.fillStyle = COLORS.wall;
  ctx.fill();
  if (stage >= 2) {
    hexPath(ctx, x, y, layout.size, 0.52);
    ctx.fillStyle = COLORS.wall2;
    ctx.fill();
  }
}

function drawTarget(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex): void {
  const { x, y } = centerOf(layout, cell);
  [0.56, 0.38, 0.18].forEach((scale, i) => {
    ctx.beginPath();
    ctx.arc(x, y, layout.size * scale, 0, Math.PI * 2);
    ctx.fillStyle = i === 1 ? COLORS.targetRing : COLORS.target;
    ctx.fill();
  });
}

function drawRoller(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, active: boolean): void {
  const { x, y } = centerOf(layout, cell);
  if (active) {
    hexPath(ctx, x, y, layout.size, 0.92);
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, layout.size * 0.56, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.roller;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, layout.size * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.rollerDark;
  ctx.fill();
}

function drawTire(ctx: CanvasRenderingContext2D, layout: HexLayout, x: number, y: number, heavy: boolean): void {
  ctx.beginPath();
  ctx.arc(x, y, layout.size * (heavy ? 0.46 : 0.34), 0, Math.PI * 2);
  ctx.fillStyle = COLORS.tire;
  ctx.fill();
  ctx.strokeStyle = heavy ? COLORS.select : COLORS.roller;
  ctx.lineWidth = heavy ? 8 : 5;
  ctx.stroke();
}

function draw(ctx: CanvasRenderingContext2D, state: State, anim: Anim<State, ShotResult> | null): void {
  // 動きを見せている間は、撃つ前の盤の上でタイヤを動かす
  const shown = anim ? anim.from : state;
  const layout = layoutOf(shown);
  drawBoard(ctx, layout, shown);
  if (!anim && state.status === 'playing') drawAim(ctx, layout, shown);

  const path = anim?.events.path ?? [];
  const progress = anim ? anim.t * path.length : 0;
  const passed = new Set((anim?.events.hitAt ?? []).filter((i) => progress >= i + 0.5).map((i) => keyOf(...path[i])));

  for (const [key, stage] of Object.entries(shown.walls)) drawWall(ctx, layout, hexOf(key), stage);
  for (const key of shown.targets) if (!passed.has(key)) drawTarget(ctx, layout, hexOf(key));
  shown.rollers.forEach((key, i) => drawRoller(ctx, layout, hexOf(key), i === selected && shown.status === 'playing'));

  if (anim) {
    const from = hexOf(shown.rollers[selected]);
    const index = Math.min(path.length - 1, Math.floor(progress));
    const a = centerOf(layout, index === 0 ? from : path[index - 1]);
    const b = centerOf(layout, path[index]);
    const f = Math.min(1, progress - index);
    drawTire(ctx, layout, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, kindShown === 'heavy');
  }
}

/** 動きを見せている間のタイヤの種類（撃った後に選択が切り替わることがあるので、別に持つ） */
let kindShown: TireKind = 'light';

export const game: GameDef<State, ShotResult> = {
  saveKey: 'roller-break.v1',
  title: 'ROLLER BREAK',
  howto: t('タイヤを転がして、的を全部倒そう。少ない発射数で倒すほど星が増える。', 'Roll tires to knock down every target. Fewer shots earn more stars.'),
  view: VIEW,
  levelCount: LEVELS.length,

  start(level) {
    levelIndex = level;
    selected = 0;
    kind = 'light';
    return createState(LEVELS[level]);
  },
  status: (state) => state.status,
  stars: starsOf,
  counter: (state) => {
    const left = state.limit - state.shots;
    return t(`残り ${left} 発（★3 は ${state.par} 発）`, `${left} shots left (★3: ${state.par})`);
  },
  hint: (level) => {
    const hint = HINTS[level];
    return hint ? t(...hint) : '';
  },
  failText: () => t('タイヤを使い切りました', 'Out of tires'),

  buttons(state) {
    if (LEVELS[levelIndex].heavy === 0) return [];
    return [
      { id: 'light', label: t('軽いタイヤ', 'Light tire'), selected: kind === 'light' },
      { id: 'heavy', label: t(`重いタイヤ ×${state.heavyLeft}`, `Heavy tire ×${state.heavyLeft}`), selected: kind === 'heavy', disabled: state.heavyLeft === 0 },
    ];
  },
  press(state, id) {
    kind = id === 'heavy' && state.heavyLeft > 0 ? 'heavy' : 'light';
    return { state, sound: 'tap' };
  },

  tap(state, x, y) {
    const cell = hexAt(layoutOf(state), x, y);
    if (!inBoard(cell[0], cell[1], state.radius)) return null;
    const roller = state.rollers.indexOf(keyOf(cell[0], cell[1]));
    if (roller >= 0) {
      selected = roller;
      return { state, sound: 'tap' };
    }
    const dir = dirTo(hexOf(state.rollers[selected]), cell);
    if (dir < 0) return null;
    const result = fire(state, { roller: selected, dir, kind });
    if (!result) return null;
    kindShown = kind;
    if (result.state.heavyLeft === 0) kind = 'light';
    const hit = result.hitAt.length > 0 || result.end === 'wall';
    return { state: result.state, events: result, ms: 70 * result.path.length + 120, sound: hit ? 'hit' : 'miss' };
  },

  draw,
};
