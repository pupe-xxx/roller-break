// このゲームの画面。盤を描き、タップを発射に直して、外枠（shell）に渡す。
import { DIRS, boardCells, dirTo, hexOf, inBoard, keyOf, type Hex } from '../game/hex';
import { LEVELS, PLATE_INTRO_AT, PUSH_INTRO_AT } from '../game/levels';
import { createState, fire, starsOf, type ShotResult, type State, type TireKind } from '../game/rules';
import { centerOf, hexAt, hexPath, layoutFor, type HexLayout } from './hexview';
import { t } from './i18n';
import type { Anim, GameDef, RuleEntry } from './shell';

// 論理サイズ。描画はすべてこの座標で書く（実際の大きさは kit/scale が合わせる）
const VIEW = { width: 720, height: 720 } as const;
const COLORS = {
  bg: '#0a111b', cell: '#16243a', grid: '#22344f', aim: 'rgba(255,224,130,0.5)',
  wall: '#7d8fa3', wallEdge: '#4a5a6e', wall2: '#dfe7ef', target: '#ff3d3d', targetRing: '#ffffff',
  plate: '#26c6da', plateDark: '#0b3238',
  roller: '#ffd54f', rollerIdle: '#8d7f58', rollerDark: '#2b2410', skin: '#ffe0b2', select: '#ffe082', tire: '#263238',
} as const;

// 画面の言葉では「転師」と言わず、「キャラ」と言う（初めての人には何のことか分からないため）
const HINTS: Record<number, [ja: string, en: string]> = {
  0: ['黄色いキャラがあなた。キャラのまっすぐ先をタップすると、タイヤを転がして的を倒す', 'The yellow character is you. Tap a cell in a straight line from it to roll a tire at a target'],
  1: ['壁は、軽いタイヤ1発で1段削れる。先に壁をどかそう', 'A light tire chips one layer off a wall. Clear the wall first'],
  2: ['重いタイヤは的を貫いて進む。壁は、何段あっても1発で壊す', 'A heavy tire rolls straight through targets, and smashes a wall of any thickness in one shot'],
  [PUSH_INTRO_AT]: ['仲間の向こう側（点線の枠）をタップすると、仲間にタイヤが当たり、1マス押されて動く。キャラをタップすると、撃つ人が替わる', 'Tap beyond your partner (the dashed frame) to hit them with a tire and push them one cell. Tap a character to switch who fires'],
  [PLATE_INTRO_AT]: ['水色の板に当たると、矢印の向きへ曲がる。当たるたびに板の向きが入れ替わる', 'A tire turns at a cyan plate, following its arrow. The plate flips each time it is hit'],
};

// ルールブック。from 番目のステージまで進むと読めるようになる
const RULES: RuleEntry[] = [
  {
    from: 0,
    title: t('キャラとタイヤ', 'Characters and tires'),
    text: t(
      '黄色いキャラがあなた。キャラのまっすぐ先のマスをタップすると、その向きにタイヤを転がす。点線が、タイヤの通る道。赤い的を全部倒すとクリア。',
      'The yellow character is you. Tap a cell in a straight line from it to roll a tire that way. The dotted line shows where the tire will go. Knock down every red target to clear the stage.',
    ),
  },
  {
    from: 0,
    title: t('星と発射数', 'Stars and shots'),
    text: t(
      '右上の「★3 は ○ 発」が、一番少ない発射数。その数で倒しきると ★3、1発多いと ★2。それより多くは撃てない。残りの数は、下のボタンに書いてある。',
      'The ★3 number at the top is the fewest shots possible. Match it for ★3; one more gives ★2. You cannot fire more than that. The buttons below show how many shots are left.',
    ),
  },
  {
    from: 0,
    title: t('1手戻す・やり直す', 'Undo and retry'),
    text: t('↶ で1手戻す。↻ でステージを最初からやり直す。', '↶ takes back one shot. ↻ restarts the stage.'),
  },
  {
    from: 1,
    title: t('壁', 'Walls'),
    text: t(
      'タイヤは壁に当たると止まる。軽いタイヤは、壁を1段削る。中に明るい六角形がある壁は2段あり、軽いタイヤなら2発かかる。',
      'A tire stops at a wall. A light tire chips off one layer. A wall with a bright hexagon inside has two layers, so it takes two light tires.',
    ),
  },
  {
    from: 2,
    title: t('重いタイヤ', 'Heavy tires'),
    text: t(
      '的を倒しても止まらず、貫いて進む。壁は、何段あっても1発で壊す（壁では止まる）。使える数が決まっている。',
      'It keeps rolling through targets. It smashes a wall of any thickness in one shot (and stops there). You only get a few.',
    ),
  },
  {
    from: PUSH_INTRO_AT,
    title: t('仲間を押す', 'Pushing a partner'),
    text: t(
      'キャラが2人以上いる時は、キャラをタップして撃つ人を選ぶ。仲間にタイヤを当てると、仲間は1マス押されて動き、狙える線が変わる。先のマスがふさがっている時は動かない。点線の枠が、動く先。仲間をタップすると撃つ人が替わるので、押したい時は、仲間の向こう側のマス（点線の枠）をタップする。',
      'With two or more characters, tap one to choose who fires. A tire that hits a partner pushes them one cell, changing what they can aim at. They do not move if the next cell is blocked. The dashed frame shows where they will land. Tapping a partner selects them, so to push, tap the cell beyond them (the dashed frame).',
    ),
  },
  {
    from: PLATE_INTRO_AT,
    title: t('向きを変える板', 'Turning plates'),
    text: t(
      '水色の板に当たったタイヤは、矢印の向きへ曲がって進み続ける。当たるたびに、板の矢印が逆向きに入れ替わる。曲がった先のマスをタップしても撃てる。',
      'A tire that hits a cyan plate turns the way its arrow points and keeps rolling. The arrow flips each time the plate is hit. You can also tap a cell beyond the bend to fire.',
    ),
  },
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

/** 選んでいる転師が、今のタイヤで dir の向きに撃った時の結果。タイヤが通るマスは、盤の中の分だけ返す */
function aimOf(state: State, dir: number): { shot: ShotResult; cells: Hex[] } | null {
  const shot = fire(state, { roller: selected, dir, kind });
  if (!shot) return null;
  return { shot, cells: shot.path.filter(([q, r]) => inBoard(q, r, state.radius)) };
}

/**
 * 選んでいるキャラから撃って、何かが起きる線だけを見せる（何も起きない向きは描かない。線が多いと見づらいため）。
 * 線は、今選んでいるタイヤが通る道に沿って、止まる所まで引く。当たる物には輪を付ける。
 */
function drawAim(ctx: CanvasRenderingContext2D, layout: HexLayout, state: State): void {
  const from = state.rollers[selected];
  if (from === undefined) return;
  const start = centerOf(layout, hexOf(from));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.aim;
  for (let dir = 0; dir < DIRS.length; dir++) {
    const aim = aimOf(state, dir);
    if (!aim || !aim.shot.changed || aim.cells.length === 0) continue;
    const { shot, cells } = aim;
    ctx.lineWidth = 3;
    ctx.setLineDash([2, 9]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const cell of cells) {
      const { x, y } = centerOf(layout, cell);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // 当たる物（最後に止まる壁か仲間と、倒れる的）に輪を付ける
    const marks = shot.hitAt.map((k) => shot.path[k]);
    if (shot.end === 'wall' || shot.end === 'roller') marks.push(cells[cells.length - 1]);
    for (const cell of marks) {
      const { x, y } = centerOf(layout, cell);
      hexPath(ctx, x, y, layout.size, 0.9);
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    // 仲間が押される時は、動く先のマスを点線の枠で見せる
    if (shot.pushed >= 0) {
      const { x, y } = centerOf(layout, hexOf(shot.state.rollers[shot.pushed]));
      hexPath(ctx, x, y, layout.size, 0.7);
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** 向きを変える板。丸い矢印が、曲げる向き（左回りか右回りか）を表す */
function drawPlate(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, turn: number): void {
  const { x, y } = centerOf(layout, cell);
  const size = layout.size;
  hexPath(ctx, x, y, size, 0.84);
  ctx.fillStyle = COLORS.plateDark;
  ctx.fill();
  ctx.strokeStyle = COLORS.plate;
  ctx.lineWidth = 4;
  ctx.stroke();
  // 画面では、左へ曲げる（turn = 1）が左回り
  const ccw = turn > 0;
  const radius = size * 0.36;
  const a0 = -Math.PI * 0.5, sweep = Math.PI * 1.4;
  const a1 = ccw ? a0 - sweep : a0 + sweep;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, size * 0.11);
  ctx.beginPath();
  ctx.arc(x, y, radius, a0, a1, ccw);
  ctx.stroke();
  // 矢じり。弧の終わりで、進む向きを指す
  const tx = x + Math.cos(a1) * radius, ty = y + Math.sin(a1) * radius;
  const heading = a1 + (ccw ? -Math.PI / 2 : Math.PI / 2);
  const head = size * 0.24;
  ctx.beginPath();
  ctx.moveTo(tx + Math.cos(heading) * head, ty + Math.sin(heading) * head);
  ctx.lineTo(tx + Math.cos(heading + 2.3) * head, ty + Math.sin(heading + 2.3) * head);
  ctx.lineTo(tx + Math.cos(heading - 2.3) * head, ty + Math.sin(heading - 2.3) * head);
  ctx.closePath();
  ctx.fillStyle = COLORS.plate;
  ctx.fill();
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

/**
 * 操作するキャラ。帽子をかぶった人が、タイヤを抱えている絵で描く（的・壁・板とは形で見分けられる）。
 * 選んでいるキャラは明るい色で、足もとに光る台が付く。選んでいないキャラは色を落とす。
 */
function drawRoller(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, active: boolean): void {
  const { x, y } = centerOf(layout, cell);
  const u = layout.size;
  const body = active ? COLORS.roller : COLORS.rollerIdle;
  if (active) {
    hexPath(ctx, x, y, u, 0.92);
    ctx.fillStyle = 'rgba(255,213,79,0.22)';
    ctx.fill();
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.rollerDark;
  ctx.lineWidth = 3;
  // 体
  ctx.beginPath();
  ctx.moveTo(x - u * 0.36, y + u * 0.56);
  ctx.quadraticCurveTo(x - u * 0.4, y - u * 0.02, x, y - u * 0.04);
  ctx.quadraticCurveTo(x + u * 0.4, y - u * 0.02, x + u * 0.36, y + u * 0.56);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.stroke();
  // 頭
  ctx.beginPath();
  ctx.arc(x, y - u * 0.28, u * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = active ? COLORS.skin : '#b8a58a';
  ctx.fill();
  ctx.stroke();
  // 帽子
  ctx.beginPath();
  ctx.arc(x, y - u * 0.32, u * 0.25, Math.PI, 0);
  ctx.lineTo(x + u * 0.36, y - u * 0.32);
  ctx.lineTo(x - u * 0.25, y - u * 0.32);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.stroke();
  // 抱えているタイヤ
  ctx.beginPath();
  ctx.arc(x, y + u * 0.3, u * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.tire;
  ctx.fill();
  ctx.strokeStyle = active ? '#ffffff' : '#9aa7b3';
  ctx.lineWidth = 3;
  ctx.stroke();
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
  for (const [key, turn] of Object.entries(shown.plates)) drawPlate(ctx, layout, hexOf(key), turn);
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
  // ステージの並びを変えたら番号を上げる（前の並びの星が、別のステージに付いてしまうため）
  saveKey: 'roller-break.v2',
  title: 'ROLLER BREAK',
  howto: t('黄色いキャラを操作して、タイヤを転がし、的を全部倒そう。少ない発射数で倒すほど星が増える。', 'Guide the yellow characters, roll tires, and knock down every target. Fewer shots earn more stars.'),
  view: VIEW,
  levelCount: LEVELS.length,
  rules: RULES,
  undoable: true,

  start(level) {
    levelIndex = level;
    selected = 0;
    kind = 'light';
    return createState(LEVELS[level]);
  },
  status: (state) => state.status,
  stars: starsOf,
  counter: (state) => {
    return t(`★3 は ${state.par} 発`, `★3: ${state.par} shots`);
  },
  hint: (level) => {
    const hint = HINTS[level];
    return hint ? t(...hint) : '';
  },
  failText: () => t('タイヤを使い切りました', 'Out of tires'),

  buttons(state) {
    // 残りの数は、ボタンに書く。軽いタイヤの数は、あと何発撃てるか（重いタイヤも、その1発に数える）。
    // 重いタイヤの数は、持っている数をそのまま書く（残りの発射数に合わせて減らすと、使っていないのに減って見える）
    const left = state.limit - state.shots;
    const light = { id: 'light', label: t(`軽いタイヤ ×${left}`, `Light tire ×${left}`), selected: kind === 'light' };
    if (LEVELS[levelIndex].heavy === 0) return [light];
    const heavy = state.heavyLeft;
    return [light, { id: 'heavy', label: t(`重いタイヤ ×${heavy}`, `Heavy tire ×${heavy}`), selected: kind === 'heavy', disabled: heavy === 0 }];
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
    // まっすぐ先のマスのほか、板で曲がった先のマスをタップしても、その線で撃つ
    let dir = dirTo(hexOf(state.rollers[selected]), cell);
    if (dir < 0) dir = DIRS.findIndex((_, d) => aimOf(state, d)?.cells.some(([q, r]) => q === cell[0] && r === cell[1]));
    if (dir < 0) return null;
    const result = fire(state, { roller: selected, dir, kind });
    if (!result) return null;
    kindShown = kind;
    if (result.state.heavyLeft === 0) kind = 'light';
    return { state: result.state, events: result, ms: 70 * result.path.length + 120, sound: result.changed ? 'hit' : 'miss' };
  },

  draw,
};
