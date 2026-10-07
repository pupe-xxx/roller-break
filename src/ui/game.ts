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
  bg: '#0a111b', cell: '#16243a', grid: '#22344f', aim: 'rgba(255,224,130,0.55)',
  wall: '#7d8fa3', wallEdge: '#4a5a6e', wall2: '#dfe7ef', target: '#ff3d3d', targetRing: '#ffffff',
  roller: '#ffd54f', rollerIdle: '#9c8a55', rollerDark: '#2b2410', select: '#ffe082', tire: '#263238',
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
    // マスは1色にする（2色に塗り分けると、壁や狙いの線と見分けにくい）
    ctx.fillStyle = COLORS.cell;
    ctx.fill();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/**
 * 選んでいる転師から撃てる6本の線を見せる。線は、今選んでいるタイヤが止まる所（壁・的・ほかの転師）まで引く。
 * 何かに当たる線は、止まるマスに輪を付ける。何にも当たらない線は、盤の端まで薄く引く。
 */
function drawAim(ctx: CanvasRenderingContext2D, layout: HexLayout, state: State): void {
  const from = state.rollers[selected];
  if (from === undefined) return;
  const start = centerOf(layout, hexOf(from));
  ctx.lineCap = 'round';
  for (let dir = 0; dir < DIRS.length; dir++) {
    const shot = fire(state, { roller: selected, dir, kind });
    if (!shot || shot.path.length < 2 && shot.end === 'out') continue;
    const hits = shot.end !== 'out' || shot.hitAt.length > 0;
    // 盤の外に出た時は、最後のマス（盤の外）の1つ手前まで
    const last = shot.end === 'out' ? shot.path[shot.path.length - 2] : shot.path[shot.path.length - 1];
    if (!last) continue;
    const end = centerOf(layout, last);
    ctx.globalAlpha = hits ? 1 : 0.3;
    ctx.strokeStyle = COLORS.aim;
    ctx.lineWidth = hits ? 5 : 3;
    ctx.setLineDash(hits ? [] : [3, 11]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // 当たる物（最後に止まる物と、重いタイヤが貫く的）に輪を付ける
    const marks = shot.hitAt.map((k) => shot.path[k]);
    if (shot.end === 'wall' || shot.end === 'roller') marks.push(last);
    for (const cell of marks) {
      const { x, y } = centerOf(layout, cell);
      hexPath(ctx, x, y, layout.size, 0.9);
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawWall(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, stage: number): void {
  const { x, y } = centerOf(layout, cell);
  hexPath(ctx, x, y, layout.size, 0.84);
  ctx.fillStyle = COLORS.wall;
  ctx.fill();
  ctx.strokeStyle = COLORS.wallEdge;
  ctx.lineWidth = 4;
  ctx.stroke();
  if (stage >= 2) {
    hexPath(ctx, x, y, layout.size, 0.52);
    ctx.fillStyle = COLORS.wall2;
    ctx.fill();
  }
}

function drawTarget(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex): void {
  const { x, y } = centerOf(layout, cell);
  // 白いふちを付けて、暗い盤の上でも一目で見つかるようにする
  [0.66, 0.56, 0.36, 0.17].forEach((scale, i) => {
    ctx.beginPath();
    ctx.arc(x, y, layout.size * scale, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? COLORS.targetRing : COLORS.target;
    ctx.fill();
  });
}

/** 転師は六角形の台で描く（的は丸なので、形でも見分けられる）。選んでいない転師は色を落とす */
function drawRoller(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, active: boolean): void {
  const { x, y } = centerOf(layout, cell);
  hexPath(ctx, x, y, layout.size, 0.78);
  ctx.fillStyle = active ? COLORS.roller : COLORS.rollerIdle;
  ctx.fill();
  ctx.strokeStyle = active ? '#ffffff' : COLORS.rollerDark;
  ctx.lineWidth = active ? 5 : 3;
  ctx.stroke();
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

  const path = anim?.events.path ?? [];
  const progress = anim ? anim.t * path.length : 0;
  const passed = new Set((anim?.events.hitAt ?? []).filter((i) => progress >= i + 0.5).map((i) => keyOf(...path[i])));

  for (const [key, stage] of Object.entries(shown.walls)) drawWall(ctx, layout, hexOf(key), stage);
  for (const key of shown.targets) if (!passed.has(key)) drawTarget(ctx, layout, hexOf(key));
  if (!anim && state.status === 'playing') drawAim(ctx, layout, shown);
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
