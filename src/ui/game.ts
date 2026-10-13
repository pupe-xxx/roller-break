// このゲームの画面。盤を描き、タップを発射に直して、外枠（shell）に渡す。
import { DIRS, boardCells, dirTo, hexDist, hexOf, inBoard, keyOf, type Hex } from '../game/hex';
import { BLOCK_SIZE, BOMB_INTRO_AT, COMBO_INTRO_AT, HEAVY_INTRO_AT, IRON_INTRO_AT, MIRROR_INTRO_AT, SHIELD_INTRO_AT, WARP_INTRO_AT, LEVELS, PLATE_INTRO_AT, PUSH_INTRO_AT, WALL_INTRO_AT } from '../game/levels';
import { createState, fire, lightLeft, starsOf, type Level, type Shot, type ShotResult, type State, type TireKind } from '../game/rules';
import { solveFrom } from '../game/solve';
import { centerOf, hexAt, hexPath, layoutFor, type HexLayout } from './hexview';
import rollerUrl from './roller.png';
import { t } from './i18n';
import type { Anim, GameDef, RuleEntry } from './shell';

// 論理サイズ。描画はすべてこの座標で書く（実際の大きさは kit/scale が合わせる）
const VIEW = { width: 720, height: 720 } as const;
const COLORS = {
  bg: '#0a111b', cell: '#16243a', grid: '#22344f', aim: 'rgba(255,224,130,0.5)',
  wall: '#8d939c', wallLine: '#6c727b', target: '#ff2e4d', targetDark: '#b0132f', targetRing: '#ffd0d8',
  plate: '#26c6da', plateDark: '#123c44',
  iron: '#2e3440', ironSide: '#14181e', bronze: '#c19a5b', bomb: '#1b1b1b', fuse: '#ffab40', shield: '#4fc3f7',
  mirror: '#e3e9ee', mirrorDark: '#59636e', warps: ['#b388ff', '#ff80ab', '#69f0ae'], hole: '#05080d',
  stone: '#8d939c', stoneLight: '#a7adb5', stoneDark: '#4a4f57', stoneSide: '#30353d', stoneEdge: '#1b1f25', seam: '#4dd0e1', heat: '#ff7a1a',
  roller: '#ffd54f', rollerIdle: '#8d7f58', rollerDark: '#2b2410', skin: '#ffe0b2', select: '#ffe082', tire: '#263238',
} as const;

// 操作キャラの絵。読み込みが終わってから遊び始める（main.ts）。読み込めなくても、仮の絵で遊べる
const rollerImage = new Image();
export const rollerImageReady = new Promise<void>((resolve) => {
  rollerImage.onload = rollerImage.onerror = () => resolve();
  setTimeout(resolve, 3000);
  rollerImage.src = rollerUrl;
});

/** 次の区切り（BLOCK_SIZE 個）を開くのに要る星。k 番目の区切りは、星の合計が BLOCK_STARS × k に届くと開く（平均 ★2 で届く） */
const BLOCK_STARS = BLOCK_SIZE * 2;

// 画面の言葉では「転師」と言わず、「キャラ」と言う（初めての人には何のことか分からないため）
const HINTS: Record<number, [ja: string, en: string]> = {
  0: ['光る枠のキャラがあなた。キャラのまっすぐ先をタップすると、タイヤを転がして的を倒す', 'The character in the glowing frame is you. Tap a cell in a straight line from it to roll a tire at a target'],
  [WALL_INTRO_AT]: ['壁は、軽いタイヤ1発で1段削れる。先に壁をどかそう', 'A light tire chips one layer off a wall. Clear the wall first'],
  [HEAVY_INTRO_AT]: ['重いタイヤは、的と壁を合わせて3つまで壊して進む。壁は1段で1つと数える', 'A heavy tire breaks up to three things in a row: targets and walls, each wall layer counting as one'],
  [PUSH_INTRO_AT]: ['仲間の向こう側（点線の枠）をタップすると、仲間にタイヤが当たり、1マス押されて動く。キャラをタップすると、撃つ人が替わる', 'Tap beyond your partner (the dashed frame) to hit them with a tire and push them one cell. Tap a character to switch who fires'],
  [PLATE_INTRO_AT]: ['水色の板に当たると、矢印の向きへ曲がる。当たるたびに板の向きが入れ替わる', 'A tire turns at a cyan plate, following its arrow. The plate flips each time it is hit'],
  [IRON_INTRO_AT]: ['鉄の壁は、重いタイヤでも壊れない。向こうの的は、別の向きから狙おう', 'Iron walls never break, even for a heavy tire. Aim at what is behind them from another side'],
  [BOMB_INTRO_AT]: ['爆弾にタイヤを当てると爆ぜて、周りの的も一緒に倒れる。爆弾は倒さなくてもクリアできる', 'Roll a tire into a bomb and it explodes, knocking down the targets around it. You do not have to blow up bombs to clear'],
  [SHIELD_INTRO_AT]: ['水色の枠の的は、盾付き。軽いタイヤでは倒れない。重いタイヤか爆弾で倒す', 'A target in a cyan frame has a shield. Light tires bounce off it; use a heavy tire or a bomb'],
  [WARP_INTRO_AT]: ['ワープ穴に入ったタイヤは、同じ番号の穴から、同じ向きのまま出てくる', 'A tire that rolls into a warp hole comes out of the hole with the same number, still heading the same way'],
  [MIRROR_INTRO_AT]: ['跳ね返す板に当たると、タイヤは来た道を戻る。戻ったタイヤは、撃ったキャラも押す', 'A tire bounces straight back off a mirror plate. On the way back, it can push the character who fired it'],
  [COMBO_INTRO_AT]: ['板で曲げたタイヤを仲間に当てると、曲がった先の向きへ仲間が動く。まっすぐ撃てない所の仲間も動かせる', 'A tire bent by a plate still pushes a partner, in the new direction. Use it to move partners you cannot hit straight on'],
};

// ルールブックの動く絵に使う、小さな盤。ステージとは別に作る（ステージの答えを、先に見せないため）
const DEMOS = {
  basic: { radius: 2, rollers: [[-1, 0]], targets: [[1, 0], [-1, 2]], walls: [], heavy: 0, par: 2 },
  wall: { radius: 2, rollers: [[-2, 1]], targets: [[1, 1]], walls: [[0, 1, 2]], heavy: 0, par: 3 },
  heavy: { radius: 2, rollers: [[-2, 0]], targets: [[0, 0], [1, 0]], walls: [[-1, 0, 2]], heavy: 1, par: 2 },
  push: { radius: 2, rollers: [[0, 2], [0, 0]], targets: [[2, -1]], walls: [], heavy: 0, par: 2 },
  plate: { radius: 2, rollers: [[2, -1]], targets: [[0, -2], [-2, 1]], walls: [], plates: [[0, -1, -1]], heavy: 0, par: 2 },
  combo: { radius: 2, rollers: [[0, -2], [1, -1]], targets: [[0, 1]], walls: [], plates: [[0, -1, 1]], heavy: 0, par: 2 },
  iron: { radius: 2, rollers: [[1, 0], [2, 0]], targets: [[-2, 0], [2, -2]], walls: [], iron: [[2, -1]], heavy: 0, par: 3 },
  bomb: { radius: 2, rollers: [[-2, 0]], targets: [[1, -1], [0, 1]], bombs: [[0, 0]], walls: [[-1, 1, 2]], plates: [[1, 0, 1]], heavy: 0, par: 1 },
  shield: { radius: 2, rollers: [[-2, 2]], targets: [[-2, 1], [2, -2], [0, 0]], shields: [[-2, 1]], walls: [], heavy: 1, par: 3 },
  warp: { radius: 2, rollers: [[-1, -1]], targets: [[-2, 2], [2, -1], [0, -1]], warps: [[-1, 1, -2, 0]], walls: [], heavy: 0, par: 3 },
  mirror: { radius: 2, rollers: [[1, 1], [2, -1]], targets: [[0, -2], [0, 2]], mirrors: [[2, 0]], walls: [], heavy: 0, par: 3 },
} satisfies Record<string, Level>;

// ルールブック。from 番目のステージまで進むと読めるようになる。
// scope が 'general' の項目は「ゲーム全体のルール」、ほかは「ステージのルール」に入る
const RULES: RuleEntry[] = [
  {
    from: 0,
    title: t('タイヤを転がす', 'Rolling a tire'),
    text: t(
      '光る枠のキャラがあなた。点線の先をタップすると、タイヤを転がして的を倒す。赤い的を全部倒すとクリア。',
      'The character in the glowing frame is you. Tap along a dotted line to roll a tire and knock down a target. Knock down every red target to clear the stage.',
    ),
    demo: demoOf(DEMOS.basic),
  },
  {
    from: WALL_INTRO_AT,
    title: t('壁', 'Walls'),
    text: t(
      'タイヤは壁で止まる。軽いタイヤは、1発で壁を1段削る。中に明るい六角形がある壁は2段。',
      'A tire stops at a wall. A light tire chips off one layer per shot. A wall with a bright hexagon inside has two layers.',
    ),
    demo: demoOf(DEMOS.wall),
  },
  {
    from: HEAVY_INTRO_AT,
    title: t('重いタイヤ', 'Heavy tires'),
    text: t(
      '下のボタンで選ぶ。的と壁を合わせて3つまで壊しながら進み、3つ壊した所で止まる。的は1つで1つ、壁は1段で1つと数える（2段の壁は2つ分）。仲間に当たると止まる。',
      'Pick it with the button below. It rolls on, breaking up to three things, and stops after the third. Each target counts as one, and so does each wall layer (a two-layer wall counts as two). A partner stops it.',
    ),
    demo: demoOf(DEMOS.heavy),
  },
  {
    from: PUSH_INTRO_AT,
    title: t('仲間を押す', 'Pushing a partner'),
    text: t(
      '仲間の向こう側（点線の枠）をタップすると、タイヤが当たって、仲間が1マス動く。先がふさがっていると動かない。キャラをタップすると、撃つ人が替わる。',
      'Tap beyond your partner (the dashed frame) to hit them with a tire and push them one cell. They do not move if that cell is blocked. Tap a character to switch who fires.',
    ),
    demo: demoOf(DEMOS.push),
  },
  {
    from: PLATE_INTRO_AT,
    title: t('向きを変える板', 'Turning plates'),
    text: t(
      '水色の板に当たったタイヤは、矢印の向きへ曲がる。当たるたびに、矢印が逆向きになる。',
      'A tire that hits a cyan plate turns the way its arrow points. The arrow flips each time the plate is hit.',
    ),
    demo: demoOf(DEMOS.plate),
  },
  {
    from: COMBO_INTRO_AT,
    title: t('板で曲げて押す', 'Pushing around a plate'),
    text: t(
      '板で曲がったタイヤも、仲間に当たれば押す。仲間は、曲がった後のタイヤの向きへ1マス動く。まっすぐ撃てない所にいる仲間も、板を使えば動かせる。',
      'A tire bent by a plate still pushes a partner it hits, one cell in the direction it is now rolling. Plates let you move partners you cannot hit straight on.',
    ),
    demo: demoOf(DEMOS.combo),
  },
  {
    from: IRON_INTRO_AT,
    title: t('鉄の壁', 'Iron walls'),
    text: t(
      'びょうの付いた暗い壁は、鉄の壁。軽いタイヤでも重いタイヤでも壊れず、タイヤはそこで止まる。仲間を鉄の壁へ押すこともできない。',
      'A dark wall with rivets is iron. No tire can break it, light or heavy; the tire just stops. You cannot push a partner into it either.',
    ),
    demo: demoOf(DEMOS.iron),
  },
  {
    from: BOMB_INTRO_AT,
    title: t('爆弾', 'Bombs'),
    text: t(
      'ひびの光る黒い玉は、爆弾。タイヤが当たると、タイヤはそこで止まり、爆弾が爆ぜる。周りの6マスにある的を倒し、壁を1段削り、板と跳ね返す板を壊す（鉄の壁・ワープ穴・仲間はそのまま）。巻き込まれた爆弾も続けて爆ぜる。爆弾は倒さなくてもクリアできる。使う板を先に使ってから爆ぜさせるなど、爆ぜさせる時を選ぼう。',
      'A black ball with glowing cracks is a bomb. When a tire hits it, the tire stops and the bomb explodes. It knocks down the targets in the six cells around it, chips one layer off walls, and destroys plates and mirror plates (iron, warp holes and partners are safe). Bombs caught in the blast explode too. You do not have to blow up bombs to clear. Pick the right moment: use a plate first, then blow it away.',
    ),
    demo: demoOf(DEMOS.bomb),
  },
  {
    from: SHIELD_INTRO_AT,
    title: t('盾付きの的', 'Shielded targets'),
    text: t(
      '水色の枠で囲まれた的は、盾付き。軽いタイヤは盾で止まり、的は倒れない。重いタイヤか、爆弾の爆発で倒れる。',
      'A target in a cyan frame has a shield. A light tire stops at the shield and the target stays up. A heavy tire or a bomb blast knocks it down.',
    ),
    demo: demoOf(DEMOS.shield),
  },
  {
    from: WARP_INTRO_AT,
    title: t('ワープ穴', 'Warp holes'),
    text: t(
      '同じ番号のワープ穴は、2つで1組。片方に入ったタイヤは、もう片方から、同じ向きのまま出てくる。どちらの穴からでも入れる。仲間をワープ穴へ押すことはできない。',
      'Warp holes with the same number are a pair. A tire that rolls into one comes out of the other, still heading the same way. Either hole works as the entrance. You cannot push a partner into a warp hole.',
    ),
    demo: demoOf(DEMOS.warp),
  },
  {
    from: MIRROR_INTRO_AT,
    title: t('跳ね返す板', 'Mirror plates'),
    text: t(
      'U の字の矢印がある銀色の板に当たると、タイヤは来た向きへまっすぐ戻る。戻る途中の物にも当たる。撃ったキャラに戻れば、そのキャラが押されて、撃った向きと逆へ1マス動く。',
      'A silver plate with a U-turn arrow sends a tire straight back the way it came, hitting things on the way back. If it reaches the character who fired it, that character is pushed one cell backwards.',
    ),
    demo: demoOf(DEMOS.mirror),
  },
  {
    from: 0,
    scope: 'general',
    title: t('星', 'Stars'),
    text: t(
      '右上の「★3 は ○ 発」が、一番少ない発射数。その数でクリアすると ★3、1発多いと ★2、それより多いと ★1。',
      'The ★3 number at the top is the fewest shots possible. Clear in that many for ★3, one more for ★2, and any more for ★1.',
    ),
  },
  {
    from: 0,
    scope: 'general',
    title: t('タイヤの数と失敗', 'Tires and failing'),
    text: t(
      '下のボタンの数が、持っているタイヤ。一番少ない発射数より3発多く持っている。使い切っても的が残ると失敗。当てられる物が無くなった時も失敗。',
      'The buttons below show how many tires you have: three more than the fewest shots needed. If you use them all and a target is still standing, you fail. You also fail when nothing can be hit any more.',
    ),
  },
  {
    from: 0,
    scope: 'general',
    title: t('ステージ', 'Stages'),
    text: t(
      `ステージは ${BLOCK_SIZE} 個ずつに分かれている。集めた星が ★${BLOCK_STARS}・★${BLOCK_STARS * 2}・… に届くと、次の ${BLOCK_SIZE} 個が開く。その中では、クリアした一番先のステージの、2つ先まで遊べる。`,
      `Stages come in sets of ${BLOCK_SIZE}. Collect ★${BLOCK_STARS}, ★${BLOCK_STARS * 2}, … to open the next set. Within a set, you can play up to two stages past the furthest one you have cleared.`,
    ),
  },
  {
    from: 0,
    scope: 'general',
    title: t('上のボタン', 'Buttons at the top'),
    text: t(
      '🏠 ホーム（ステージ選択）　↶ 1手戻す　↻ 最初からやり直す　？ ルール　🔊 音',
      '🏠 home (stages)   ↶ undo one shot   ↻ restart   ？ rules   🔊 sound',
    ),
  },
  {
    from: 0,
    scope: 'general',
    title: t('詰まった時', 'When you are stuck'),
    text: t(
      '同じステージで 2 回失敗するたびに、下の「ヒント」が1回分増える。ヒントは、次の1手を白い線で教える。ボタンに、あと何回使えるかが出る。',
      'Every two fails on a stage earn one Hint, shown on the button below with how many you have left. A hint shows the next shot as a white line.',
    ),
  },
];

let levelIndex = 0;
/** 見せているヒント。その盤面のままの間だけ見せる（撃つ・戻す・やり直すで盤面が替わると消える） */
let hint: { state: State; shot: Shot } | null = null;
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

/** タイヤの通る道を線にする。ワープ穴で飛ぶ所（隣り合わないマスの間）は、線をつながない */
function tracePath(ctx: CanvasRenderingContext2D, layout: HexLayout, from: Hex, cells: Hex[]): void {
  const start = centerOf(layout, from);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  let prev = from;
  for (const cell of cells) {
    const { x, y } = centerOf(layout, cell);
    if (hexDist(prev, cell) > 1) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    prev = cell;
  }
}

/**
 * 選んでいるキャラから撃って、何かが起きる線だけを見せる（何も起きない向きは描かない。線が多いと見づらいため）。
 * 線は、今選んでいるタイヤが通る道に沿って、止まる所まで引く。当たる物には輪を付ける。
 */
function drawAim(ctx: CanvasRenderingContext2D, layout: HexLayout, state: State): void {
  const from = state.rollers[selected];
  if (from === undefined) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.aim;
  for (let dir = 0; dir < DIRS.length; dir++) {
    const aim = aimOf(state, dir);
    if (!aim || !aim.shot.changed || aim.cells.length === 0) continue;
    const { shot, cells } = aim;
    ctx.lineWidth = 3;
    ctx.setLineDash([2, 9]);
    tracePath(ctx, layout, hexOf(from), cells);
    ctx.stroke();
    ctx.setLineDash([]);
    // 当たる物（倒れる的・当たる壁・爆弾が巻き込む物・最後に止まる仲間）に輪を付ける。重いタイヤは、線の上の壁を3つまで壊す
    const marks = [
      ...shot.hitAt.map((k) => shot.path[k]),
      ...cells.filter(([q, r]) => state.walls[keyOf(q, r)]),
      ...shot.blasts.flatMap((blast) => blast.cells),
    ];
    if (shot.end === 'roller') marks.push(cells[cells.length - 1]);
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

/** ヒントの1手。撃つキャラからタイヤの通る道を、太い白い線で見せる */
function drawHint(ctx: CanvasRenderingContext2D, layout: HexLayout, state: State, shot: Shot): void {
  const result = fire(state, shot);
  if (!result) return;
  const cells = result.path.filter(([q, r]) => inBoard(q, r, state.radius));
  const start = centerOf(layout, hexOf(state.rollers[shot.roller]));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  tracePath(ctx, layout, hexOf(state.rollers[shot.roller]), cells);
  ctx.stroke();
  hexPath(ctx, start.x, start.y, layout.size, 1);
  ctx.lineWidth = 6;
  ctx.stroke();
  // 最後のマスに矢じり
  const last = cells[cells.length - 1];
  const before = cells.length > 1 ? centerOf(layout, cells[cells.length - 2]) : start;
  if (last) {
    const end = centerOf(layout, last);
    const angle = Math.atan2(end.y - before.y, end.x - before.x);
    const head = layout.size * 0.42;
    ctx.beginPath();
    ctx.moveTo(end.x + Math.cos(angle) * head * 0.6, end.y + Math.sin(angle) * head * 0.6);
    ctx.lineTo(end.x + Math.cos(angle + 2.5) * head, end.y + Math.sin(angle + 2.5) * head);
    ctx.lineTo(end.x + Math.cos(angle - 2.5) * head, end.y + Math.sin(angle - 2.5) * head);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
}

/**
 * 石の台。STRATA の地層のように、暗い側面の上に天面を重ねて、少し盛り上がって見せる。lift は高さ（マスの大きさに対する割合）
 */
function slab(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, scale: number, lift: number, top: string, side: string): void {
  hexPath(ctx, x, y + u * lift, u, scale);
  ctx.fillStyle = side;
  ctx.fill();
  ctx.strokeStyle = COLORS.stoneEdge;
  ctx.lineWidth = Math.max(2, u * 0.05);
  ctx.stroke();
  hexPath(ctx, x, y, u, scale);
  ctx.fillStyle = top;
  ctx.fill();
  ctx.stroke();
}

/** 光る線のにじみ。描き終わったら glowOff で戻す */
function glowOn(ctx: CanvasRenderingContext2D, color: string, blur: number): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}
function glowOff(ctx: CanvasRenderingContext2D): void {
  ctx.shadowBlur = 0;
}

/** 向きを変える板。青緑の石の板に、光る丸い矢印。矢印が、曲げる向き（左回りか右回りか）を表す */
function drawPlate(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, turn: number): void {
  const { x, y } = centerOf(layout, cell);
  const size = layout.size;
  slab(ctx, x, y, size, 0.82, 0.08, COLORS.plateDark, COLORS.stoneSide);
  hexPath(ctx, x, y, size, 0.82);
  ctx.strokeStyle = COLORS.plate;
  ctx.lineWidth = 3;
  ctx.stroke();
  // 画面では、左へ曲げる（turn = 1）が左回り
  const ccw = turn > 0;
  const radius = size * 0.34;
  const a0 = -Math.PI * 0.5, sweep = Math.PI * 1.4;
  const a1 = ccw ? a0 - sweep : a0 + sweep;
  glowOn(ctx, COLORS.plate, size * 0.25);
  ctx.strokeStyle = COLORS.plate;
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
  glowOff(ctx);
}

/** 鉄の壁。暗い金属の塊に、青銅のふちとびょう（地層の筋は無い。削れる石の壁と見分ける） */
function drawIron(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex): void {
  const { x, y } = centerOf(layout, cell);
  const u = layout.size;
  slab(ctx, x, y, u, 0.88, 0.12, COLORS.iron, COLORS.ironSide);
  hexPath(ctx, x, y, u, 0.88);
  ctx.strokeStyle = COLORS.bronze;
  ctx.lineWidth = Math.max(3, u * 0.08);
  ctx.stroke();
  hexPath(ctx, x, y, u, 0.5);
  ctx.strokeStyle = COLORS.ironSide;
  ctx.lineWidth = Math.max(2, u * 0.05);
  ctx.stroke();
  ctx.fillStyle = COLORS.bronze;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * u * 0.6, y + Math.sin(a) * u * 0.6, u * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 跳ね返す板。磨いた石の板に、Uの字に戻る矢印 */
function drawMirror(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex): void {
  const { x, y } = centerOf(layout, cell);
  const u = layout.size;
  slab(ctx, x, y, u, 0.84, 0.08, COLORS.mirrorDark, COLORS.stoneSide);
  hexPath(ctx, x, y, u, 0.84);
  ctx.strokeStyle = COLORS.mirror;
  ctx.lineWidth = 4;
  ctx.stroke();
  // 磨いた面の照り
  ctx.beginPath();
  ctx.moveTo(x - u * 0.5, y - u * 0.12);
  ctx.lineTo(x - u * 0.12, y - u * 0.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = u * 0.08;
  ctx.stroke();
  ctx.strokeStyle = COLORS.mirror;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, u * 0.1);
  ctx.beginPath();
  ctx.moveTo(x + u * 0.3, y - u * 0.18);
  ctx.lineTo(x - u * 0.12, y - u * 0.18);
  ctx.arc(x - u * 0.12, y, u * 0.18, -Math.PI / 2, Math.PI / 2, true);
  ctx.lineTo(x + u * 0.3, y + u * 0.18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + u * 0.36, y + u * 0.18);
  ctx.lineTo(x + u * 0.18, y + u * 0.04);
  ctx.lineTo(x + u * 0.18, y + u * 0.32);
  ctx.closePath();
  ctx.fillStyle = COLORS.mirror;
  ctx.fill();
}

/** ワープ穴。石のふちで囲んだ暗い穴に、組ごとの色の光る輪と、同じ番号を書く */
function drawWarps(ctx: CanvasRenderingContext2D, layout: HexLayout, state: State): void {
  const done = new Set<string>();
  let pair = 0;
  for (const key of Object.keys(state.warps).sort()) {
    if (done.has(key)) continue;
    const other = state.warps[key];
    done.add(key).add(other);
    const color = COLORS.warps[pair % COLORS.warps.length];
    pair++;
    for (const cell of [key, other]) {
      const { x, y } = centerOf(layout, hexOf(cell));
      ctx.beginPath();
      ctx.arc(x, y, layout.size * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.stoneSide;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, layout.size * 0.58, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.hole;
      ctx.fill();
      glowOn(ctx, color, layout.size * 0.3);
      for (const [scale, width] of [[0.56, 5], [0.38, 3]] as const) {
        ctx.beginPath();
        ctx.arc(x, y, layout.size * scale, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      }
      ctx.font = `700 ${Math.round(layout.size * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(String(pair), x, y + 1);
      glowOff(ctx);
    }
  }
}

/** 爆弾。黒い石の玉に、オレンジの熱のひびと、火の付いた導火線。的（赤い結晶）とは別の物として置く */
function drawBomb(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex): void {
  const { x, y } = centerOf(layout, cell);
  const u = layout.size;
  const r = u * 0.42;
  // 影
  ctx.beginPath();
  ctx.ellipse(x + 2, y + r * 0.85, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill();
  glowOn(ctx, COLORS.heat, u * 0.35);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.bomb;
  ctx.fill();
  glowOff(ctx);
  ctx.strokeStyle = COLORS.stoneEdge;
  ctx.lineWidth = Math.max(2, u * 0.05);
  ctx.stroke();
  // 照り
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();
  // 熱のひび
  glowOn(ctx, COLORS.heat, u * 0.2);
  ctx.strokeStyle = COLORS.heat;
  ctx.lineWidth = Math.max(2, u * 0.055);
  ctx.lineJoin = 'round';
  for (const [a, b] of [[-2.4, -1.2], [0.2, 1.3], [1.9, 2.9]] as const) {
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.15, y + Math.sin(a) * r * 0.15);
    ctx.lineTo(x + Math.cos((a + b) / 2) * r * 0.55, y + Math.sin((a + b) / 2) * r * 0.55);
    ctx.lineTo(x + Math.cos(b) * r * 0.95, y + Math.sin(b) * r * 0.95);
    ctx.stroke();
  }
  // 導火線と火花
  ctx.strokeStyle = COLORS.fuse;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.5, y - r * 0.8);
  ctx.quadraticCurveTo(x + r * 0.8, y - r * 1.3, x + r * 1.1, y - r * 1.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + r * 1.12, y - r * 1.12, u * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.fuse;
  ctx.fill();
  glowOff(ctx);
}

/** 盾付きの的の印。的を囲む、水色に光る太い六角形の枠 */
function drawShieldMark(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex): void {
  const { x, y } = centerOf(layout, cell);
  hexPath(ctx, x, y, layout.size, 0.86);
  ctx.strokeStyle = COLORS.stoneEdge;
  ctx.lineWidth = 11;
  ctx.stroke();
  glowOn(ctx, COLORS.shield, layout.size * 0.3);
  ctx.strokeStyle = COLORS.shield;
  ctx.lineWidth = 6;
  ctx.stroke();
  glowOff(ctx);
}

/**
 * 削れる壁。地層の筋が入った石の塊。
 * 2段の壁は、同じ石の塊のまわりを、太い暗い石の枠で固める（1段の壁を強くしたものだと分かるように、中は同じ見た目にする）
 */
function drawWall(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, stage: number): void {
  const { x, y } = centerOf(layout, cell);
  const u = layout.size;
  const edge = Math.max(2, u * 0.05);
  slab(ctx, x, y, u, 0.86, 0.14, COLORS.wall, COLORS.stoneSide);
  ctx.save();
  hexPath(ctx, x, y, u, 0.86);
  ctx.clip();
  // 地層の筋
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = edge;
  for (const dy of [-0.3, 0.05, 0.38]) {
    ctx.beginPath();
    ctx.moveTo(x - u, y + u * dy);
    ctx.lineTo(x + u, y + u * (dy - 0.12));
    ctx.stroke();
  }
  // 2段：太い石の枠（枠は六角の外側に太い線を引き、内側だけ残す）
  if (stage >= 2) {
    hexPath(ctx, x, y, u, 0.86);
    ctx.strokeStyle = COLORS.stoneDark;
    ctx.lineWidth = u * 0.34;
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = COLORS.stoneEdge;
  ctx.lineWidth = edge;
  if (stage >= 2) {
    hexPath(ctx, x, y, u, 0.69);
    ctx.stroke();
    // 枠の石の継ぎ目（角ごと）
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * u * 0.69, y + Math.sin(a) * u * 0.69);
      ctx.lineTo(x + Math.cos(a) * u * 0.86, y + Math.sin(a) * u * 0.86);
      ctx.stroke();
    }
  }
  hexPath(ctx, x, y, u, 0.86);
  ctx.stroke();
}

/**
 * 的。赤く光る結晶の柱（STRATA の敵軍の色）。とがった頭の六角柱を、明るい面・真ん中の面・暗い面の3つに塗り分け、
 * 両脇に小さな結晶を2本添える。暗い盤の上でも一目で見つかるように、赤い光でにじませる
 */
function drawTarget(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex): void {
  const { x, y } = centerOf(layout, cell);
  const u = layout.size;
  // 足もとの影
  ctx.beginPath();
  ctx.ellipse(x, y + u * 0.48, u * 0.5, u * 0.16, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill();
  /** 1本の結晶。cx は中心、w は半分の幅、h は高さ（下の端から頭の先まで）、lean は傾き */
  const crystal = (cx: number, base: number, w: number, h: number, lean: number) => {
    const tip = base - h;
    const shoulder = tip + w * 1.3;
    const skew = (dy: number) => (base - dy) * lean;
    const pt = (px: number, py: number): [number, number] => [px + skew(py), py];
    const left = [pt(cx - w, base), pt(cx - w, shoulder), pt(cx, tip), pt(cx - w * 0.2, shoulder + w * 0.2), pt(cx - w * 0.2, base + w * 0.25)];
    const mid = [pt(cx - w * 0.2, base + w * 0.25), pt(cx - w * 0.2, shoulder + w * 0.2), pt(cx, tip), pt(cx + w * 0.45, shoulder + w * 0.1), pt(cx + w * 0.45, base + w * 0.2)];
    const right = [pt(cx + w * 0.45, base + w * 0.2), pt(cx + w * 0.45, shoulder + w * 0.1), pt(cx, tip), pt(cx + w, shoulder), pt(cx + w, base)];
    const face = (pts: [number, number][], color: string) => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    face(mid, COLORS.target);
    face(left, COLORS.targetRing);
    face(right, COLORS.targetDark);
    // 輪郭
    ctx.beginPath();
    [pt(cx - w, base), pt(cx - w, shoulder), pt(cx, tip), pt(cx + w, shoulder), pt(cx + w, base), pt(cx + w * 0.45, base + w * 0.2), pt(cx - w * 0.2, base + w * 0.25)].forEach(([px, py], i) =>
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py),
    );
    ctx.closePath();
    ctx.strokeStyle = COLORS.stoneEdge;
    ctx.lineWidth = Math.max(1.5, u * 0.04);
    ctx.stroke();
  };
  glowOn(ctx, COLORS.target, u * 0.5);
  ctx.beginPath();
  ctx.arc(x, y, u * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,46,77,0.35)';
  ctx.fill();
  glowOff(ctx);
  crystal(x - u * 0.3, y + u * 0.42, u * 0.12, u * 0.45, -0.25);
  crystal(x + u * 0.3, y + u * 0.42, u * 0.12, u * 0.5, 0.25);
  crystal(x, y + u * 0.48, u * 0.2, u * 1.0, 0);
  // きらめき
  const sx = x - u * 0.08, sy = y - u * 0.2, sr = u * 0.12;
  ctx.beginPath();
  ctx.moveTo(sx, sy - sr);
  ctx.lineTo(sx + sr * 0.25, sy - sr * 0.25);
  ctx.lineTo(sx + sr, sy);
  ctx.lineTo(sx + sr * 0.25, sy + sr * 0.25);
  ctx.lineTo(sx, sy + sr);
  ctx.lineTo(sx - sr * 0.25, sy + sr * 0.25);
  ctx.lineTo(sx - sr, sy);
  ctx.lineTo(sx - sr * 0.25, sy - sr * 0.25);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

/**
 * 操作するキャラ。STRATA の転師の絵（roller.png）で描く。絵が読み込めない時は、コードで描いた仮の絵に戻す。
 * 選んでいるキャラは、足もとに光る六角の台が付く。選んでいないキャラは、絵の色を落とす
 */
function drawRoller(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, active: boolean): void {
  if (!rollerImage.complete || rollerImage.naturalWidth === 0) {
    drawRollerShape(ctx, layout, cell, active);
    return;
  }
  const { x, y } = centerOf(layout, cell);
  const u = layout.size;
  if (active) {
    hexPath(ctx, x, y, u, 0.92);
    ctx.fillStyle = 'rgba(255,213,79,0.22)';
    ctx.fill();
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  const side = u * 1.7;
  ctx.save();
  if (!active) {
    ctx.filter = 'grayscale(0.7) brightness(0.6)';
    ctx.globalAlpha = 0.85;
  }
  ctx.drawImage(rollerImage, x - side / 2, y - side / 2, side, side);
  ctx.restore();
}

/** 絵が読み込めない時の、コードで描いた仮のキャラ。帽子をかぶった人が、タイヤを抱えている */
function drawRollerShape(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, active: boolean): void {
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

/**
 * 転がっているタイヤ。STRATA の転師が転がす、石の車輪で描く：石の塊を並べた外輪、内側の石の面、六角形のハブ。spin は回った角度。
 * 軽いタイヤは小さく、石の継ぎ目に青緑の光（STRATA の地層の光）。重いタイヤは大きく、面にオレンジの熱のひびが走る
 */
function drawTire(ctx: CanvasRenderingContext2D, layout: HexLayout, x: number, y: number, heavy: boolean, spin = 0): void {
  const u = layout.size;
  const r = u * (heavy ? 0.56 : 0.4);
  const rim = r * 0.28;
  const glow = heavy ? COLORS.heat : COLORS.seam;
  const blocks = heavy ? 10 : 8;
  const edge = Math.max(2, u * 0.035);
  ctx.save();
  ctx.translate(x, y);
  // 影（STRATA の駒と同じく、右下に少しずらす）
  ctx.beginPath();
  ctx.arc(2, 3, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill();
  ctx.rotate(spin);
  // 外輪の石。光る色の下地に、少し隙間を空けて石の塊を並べる（隙間が光る継ぎ目になる）
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.shadowColor = glow;
  ctx.shadowBlur = u * (heavy ? 0.3 : 0.18);
  ctx.fill();
  ctx.shadowBlur = 0;
  const gap = heavy ? 0.06 : 0.08;
  for (let i = 0; i < blocks; i++) {
    const a0 = ((Math.PI * 2) / blocks) * i + gap;
    const a1 = ((Math.PI * 2) / blocks) * (i + 1) - gap;
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a1);
    ctx.arc(0, 0, r - rim, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? COLORS.stone : COLORS.stoneLight;
    ctx.fill();
    ctx.strokeStyle = COLORS.stoneEdge;
    ctx.lineWidth = edge * 0.6;
    ctx.stroke();
  }
  // 内側の石の面
  const face = r - rim - u * 0.02;
  ctx.beginPath();
  ctx.arc(0, 0, face, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.stoneDark;
  ctx.fill();
  // 重いタイヤは、面にハブから外輪へ向かうひびが走る
  if (heavy) {
    ctx.strokeStyle = COLORS.heat;
    ctx.lineWidth = Math.max(2, u * 0.04);
    ctx.lineJoin = 'round';
    ctx.shadowColor = COLORS.heat;
    ctx.shadowBlur = u * 0.12;
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + 0.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * face * 0.35, Math.sin(a) * face * 0.35);
      ctx.lineTo(Math.cos(a + 0.35) * face * 0.62, Math.sin(a + 0.35) * face * 0.62);
      ctx.lineTo(Math.cos(a - 0.1) * face * 0.98, Math.sin(a - 0.1) * face * 0.98);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
  // 六角形のハブ。真ん中に小さな光
  hexPath(ctx, 0, 0, r * 0.32, 1);
  ctx.fillStyle = COLORS.stone;
  ctx.fill();
  ctx.strokeStyle = COLORS.stoneEdge;
  ctx.lineWidth = edge;
  ctx.stroke();
  hexPath(ctx, 0, 0, r * 0.12, 1);
  ctx.fillStyle = glow;
  ctx.fill();
  // 全体の輪郭。暗い盤の上で形が読めるように
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = COLORS.stoneEdge;
  ctx.lineWidth = edge;
  ctx.stroke();
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, state: State, anim: Anim<State, ShotResult> | null): void {
  // 動きを見せている間は、撃つ前の盤の上でタイヤを動かす
  const shown = anim ? anim.from : state;
  const layout = layoutOf(shown);
  drawBoard(ctx, layout, shown);

  const path = anim?.events.path ?? [];
  const progress = anim ? anim.t * path.length : 0;
  // 爆弾が爆ぜた所。タイヤが爆弾に着いた時に、巻き込んだ物も一緒に消す
  const blasts = (anim?.events.blasts ?? []).filter((blast) => progress >= blast.at + 0.5);
  const blasted = new Set(blasts.flatMap((blast) => blast.cells.map((cell) => keyOf(...cell))));
  const passed = new Set((anim?.events.hitAt ?? []).filter((i) => progress >= i + 0.5).map((i) => keyOf(...path[i])));

  // 壊れる壁は、タイヤが着いた所で消す（重いタイヤは、通りながら何枚も壊す）
  const reached = new Set(path.slice(0, Math.floor(progress + 0.5)).map((cell) => keyOf(...cell)));
  const broken = (key: string) => !!anim && (reached.has(key) || blasted.has(key)) && anim.events.state.walls[key] === undefined;
  for (const key of shown.iron) drawIron(ctx, layout, hexOf(key));
  // 爆弾で壊れる物（爆弾・板・跳ね返す板）は、爆ぜた所で消す
  for (const key of shown.mirrors) if (!blasted.has(key)) drawMirror(ctx, layout, hexOf(key));
  drawWarps(ctx, layout, shown);
  for (const [key, stage] of Object.entries(shown.walls)) if (!broken(key)) drawWall(ctx, layout, hexOf(key), stage);
  for (const [key, turn] of Object.entries(shown.plates)) if (!blasted.has(key)) drawPlate(ctx, layout, hexOf(key), turn);
  for (const key of shown.bombs) if (!blasted.has(key)) drawBomb(ctx, layout, hexOf(key));
  for (const key of shown.targets) {
    if (passed.has(key) || blasted.has(key)) continue;
    drawTarget(ctx, layout, hexOf(key));
    if (shown.shields.includes(key)) drawShieldMark(ctx, layout, hexOf(key));
  }
  // 爆ぜた所に、広がる火の輪を少しの間だけ描く
  for (const blast of blasts) {
    const age = progress - blast.at - 0.5;
    if (age > 3) continue;
    const { x, y } = centerOf(layout, blast.cells[0]);
    ctx.beginPath();
    ctx.arc(x, y, layout.size * (0.6 + age * 0.6), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,171,64,${1 - age / 3})`;
    ctx.lineWidth = 10;
    ctx.stroke();
  }
  if (!anim && state.status === 'playing') drawAim(ctx, layout, shown);
  shown.rollers.forEach((key, i) => drawRoller(ctx, layout, hexOf(key), i === selected && shown.status === 'playing'));
  if (!anim && hint && hint.state === state) drawHint(ctx, layout, state, hint.shot);

  if (anim) {
    const from = hexOf(shown.rollers[selected]);
    const index = Math.min(path.length - 1, Math.floor(progress));
    const prev = index === 0 ? from : path[index - 1];
    const a = centerOf(layout, prev);
    const b = centerOf(layout, path[index]);
    // ワープ穴で飛ぶ所は、すべらせずに、出口へそのまま移す
    const f = hexDist(prev, path[index]) > 1 ? 1 : Math.min(1, progress - index);
    // 進んだ距離に合わせて回す（1マス進むと、だいたい1回転の3分の1）
    drawTire(ctx, layout, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, kindShown === 'heavy', progress * 2.2);
  }
}

/** 動きを見せている間のタイヤの種類（撃った後に選択が切り替わることがあるので、別に持つ） */
let kindShown: TireKind = 'light';

/** タップする所の印。白い点と、広がる輪 */
function drawTap(ctx: CanvasRenderingContext2D, layout: HexLayout, cell: Hex, ms: number): void {
  const { x, y } = centerOf(layout, cell);
  const pulse = (ms % 600) / 600;
  ctx.beginPath();
  ctx.arc(x, y, layout.size * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, layout.size * (0.25 + 0.45 * pulse), 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,255,255,${1 - pulse})`;
  ctx.lineWidth = 8;
  ctx.stroke();
}

/**
 * ルールブックの動く絵。小さな盤を、一番少ない撃ち方の通りに撃って見せ、終わったら最初から繰り返す。
 * 遊ぶ時と同じ draw で描くので、見た目はステージと同じになる。
 */
function demoOf(level: Level): (ctx: CanvasRenderingContext2D, ms: number) => void {
  // 場面を順に並べたもの。1つの場面は「何 ms の間、どう描くか」
  let scenes: { ms: number; paint(ctx: CanvasRenderingContext2D, at: number): void }[] | null = null;
  const paint = (ctx: CanvasRenderingContext2D, state: State, anim: Anim<State, ShotResult> | null, who: number, tire: TireKind): void => {
    // draw は、今選んでいるキャラとタイヤを見て描く。遊んでいる途中の選択を壊さないように、描いたら戻す
    const keep = { selected, kind, kindShown, hint };
    selected = who;
    kind = tire;
    kindShown = tire;
    hint = null;
    draw(ctx, state, anim);
    ({ selected, kind, kindShown, hint } = keep);
    if (level.heavy === 0) return;
    // どちらのタイヤを選んでいるかを、下に書く
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = tire === 'heavy' ? COLORS.select : '#cfd8dc';
    ctx.fillText(tire === 'heavy' ? t('重いタイヤ', 'Heavy tire') : t('軽いタイヤ', 'Light tire'), VIEW.width / 2, VIEW.height - 40);
  };
  const build = () => {
    const list: NonNullable<typeof scenes> = [];
    let state = createState(level);
    let who = 0;
    for (const shot of solveFrom(state, state.limit)?.shots ?? []) {
      const before = state;
      const result = fire(before, shot);
      if (!result) break;
      const layout = layoutOf(before);
      if (shot.roller !== who) {
        // 撃つ人を替える所。替える先のキャラをタップする
        const from = who;
        list.push({ ms: 900, paint: (ctx, at) => { paint(ctx, before, null, from, shot.kind); drawTap(ctx, layout, hexOf(before.rollers[shot.roller]), at); } });
        who = shot.roller;
      }
      // 狙う所。押す時は仲間の向こう側、ほかはタイヤが最後に通るマスをタップする
      const inside = result.path.filter(([q, r]) => inBoard(q, r, before.radius));
      // 跳ね返って撃った本人に戻る時は、本人をタップすると撃つ人を選ぶことになるので、最初に通るマスをタップする
      const back = inside.some(([q, r]) => keyOf(q, r) === before.rollers[shot.roller]);
      const tapAt = back ? inside[0] : result.pushed >= 0 ? hexOf(result.state.rollers[result.pushed]) : inside[inside.length - 1];
      list.push({ ms: 1300, paint: (ctx, at) => { paint(ctx, before, null, shot.roller, shot.kind); if (tapAt && at > 600) drawTap(ctx, layout, tapAt, at); } });
      const roll = 110 * result.path.length + 150;
      list.push({ ms: roll, paint: (ctx, at) => paint(ctx, result.state, { from: before, events: result, t: at / roll }, shot.roller, shot.kind) });
      state = result.state;
    }
    const last = state, lastWho = who;
    list.push({ ms: 1500, paint: (ctx) => paint(ctx, last, null, lastWho, 'light') });
    return list;
  };
  return (ctx, ms) => {
    scenes ??= build();
    let at = ms % scenes.reduce((sum, scene) => sum + scene.ms, 0);
    for (const scene of scenes) {
      if (at < scene.ms) return scene.paint(ctx, at);
      at -= scene.ms;
    }
  };
}

/** まだタイヤは残っているが、どう撃っても盤が変わらない（当てられる物が無い）。この先は倒しきれないので、失敗にする */
const stuckOf = new WeakMap<State, boolean>();
function stuck(state: State): boolean {
  if (state.status !== 'playing') return false;
  let known = stuckOf.get(state);
  if (known === undefined) {
    const tires: TireKind[] = ['light', 'heavy'];
    known = !state.rollers.some((_, roller) => DIRS.some((_, dir) => tires.some((tire) => fire(state, { roller, dir, kind: tire })?.changed)));
    stuckOf.set(state, known);
  }
  return known;
}

export const game: GameDef<State, ShotResult> = {
  // ステージの並びを変えたら番号を上げる（前の並びの星が、別のステージに付いてしまうため）
  saveKey: 'roller-break.v7',
  title: 'ROLLER BREAK',
  howto: t('キャラを操作して、石のタイヤを転がし、的を全部倒そう。少ない発射数で倒すほど星が増える。', 'Guide your characters, roll stone tires, and knock down every target. Fewer shots earn more stars.'),
  view: VIEW,
  levelCount: LEVELS.length,
  rules: RULES,
  undoable: true,
  blocks: { blockSize: BLOCK_SIZE, blockStars: BLOCK_STARS },
  showHint(state) {
    const best = solveFrom(state, state.limit - state.shots);
    if (!best || best.shots.length === 0) {
      hint = null;
      return t('ここからは倒しきれない。↶ で戻すか、↻ でやり直そう', 'It cannot be cleared from here. Undo with ↶ or restart with ↻');
    }
    const shot = best.shots[0];
    hint = { state, shot };
    // その手を撃てるように、キャラとタイヤを選んでおく
    selected = shot.roller;
    kind = shot.kind;
    return shot.kind === 'heavy'
      ? t('白い線の通りに、重いタイヤで撃つ（線の先のマスをタップ）', 'Fire a HEAVY tire along the white line (tap a cell on it)')
      : t('白い線の通りに、軽いタイヤで撃つ（線の先のマスをタップ）', 'Fire a light tire along the white line (tap a cell on it)');
  },

  start(level) {
    levelIndex = level;
    hint = null;
    selected = 0;
    kind = 'light';
    return createState(LEVELS[level]);
  },
  status: (state) => (stuck(state) ? 'failed' : state.status),
  stars: starsOf,
  counter: (state) => {
    return t(`★3 は ${state.par} 発`, `★3: ${state.par} shots`);
  },
  hint: (level) => {
    const hint = HINTS[level];
    return hint ? t(...hint) : '';
  },
  failText: (state) => (state.status === 'failed' ? t('タイヤを使い切りました', 'Out of tires') : t('当てられる物が、もうありません', 'Nothing left that a tire can hit')),

  buttons(state) {
    // 持っているタイヤの数を、ボタンに書く。軽いタイヤと重いタイヤを合わせた数が、あと撃てる数
    const light = lightLeft(state);
    const lightButton = { id: 'light', label: t(`軽いタイヤ ×${light}`, `Light tire ×${light}`), selected: kind === 'light', disabled: light === 0 };
    if (LEVELS[levelIndex].heavy === 0) return [lightButton];
    const heavy = state.heavyLeft;
    return [lightButton, { id: 'heavy', label: t(`重いタイヤ ×${heavy}`, `Heavy tire ×${heavy}`), selected: kind === 'heavy', disabled: heavy === 0 }];
  },
  press(state, id) {
    kind = (id === 'heavy' && state.heavyLeft > 0) || lightLeft(state) === 0 ? 'heavy' : 'light';
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
    // 撃った種類のタイヤが無くなったら、残っている方に切り替える
    if (result.state.heavyLeft === 0) kind = 'light';
    else if (lightLeft(result.state) === 0) kind = 'heavy';
    return { state: result.state, events: result, ms: 70 * result.path.length + 120, sound: result.changed ? 'hit' : 'miss' };
  },

  draw,
};
