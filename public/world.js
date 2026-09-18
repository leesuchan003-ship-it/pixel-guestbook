// 픽셀 웨딩 월드.
// 배경(잔디/버진로드/아치/장식)은 오프스크린 캔버스에 한 번만 그려 캐싱하고,
// 하객·신랑신부는 매 프레임 현재 시각 기반으로 위치를 계산해 위에 겹쳐 그린다.
// 그래서 서버 동기화 없이도 모든 화면에서 "같은 시각엔 같은 위치"가 보장된다.
(function (global) {
  const WORLD_W = 240;
  const AISLE_X = 96;
  const AISLE_W = 48;
  const CX = AISLE_X + AISLE_W / 2;

  const HEAD_ROOM = 128;   // 아치와 신랑신부가 있는 상단 영역
  const FOOT_ROOM = 70;
  const ROW_H = 32;
  const SPRITE_W = 32;
  const SPRITE_H = 52;

  const ARCH_TOP = 44;
  const ALTAR_Y = 94;      // 신랑신부가 서는 바닥 높이
  const PATH_TOP = 56;

  // 버진로드를 피해 좌우로 흩어진 자리. 홀수 줄은 살짝 밀어 격자 느낌을 없앤다.
  const LEFT_LANES = [0, 24, 48, 70];
  const RIGHT_LANES = [140, 162, 186, 208];
  const LANES = LEFT_LANES.concat(RIGHT_LANES);
  const PER_ROW = LANES.length;

  const GRASS = ['#6f9c54', '#7aa75d', '#67934e', '#74a158'];
  const PATH = ['#e6d9bb', '#ded0ae', '#eaddc3'];

  const DEFAULT_COUPLE = {
    left: {
      hairStyle: 'short', outfit: 'suit', skin: '#f0c9a2', hairColor: '#191114',
      topColor: '#22252c', innerColor: '#f6f4ef', bottomColor: '#22252c',
      shoeColor: '#15171b', accentColor: '#8a4a52', accessory: 'none',
    },
    right: {
      hairStyle: 'long', outfit: 'dress', skin: '#f7d7b9', hairColor: '#2b1d17',
      topColor: '#f4f1ea', innerColor: '#ffffff', bottomColor: '#f4f1ea',
      shoeColor: '#e8e4dc', accentColor: '#f2a8bc', accessory: 'bouquet', blush: true,
    },
  };

  function rowsNeeded(n) { return Math.max(3, Math.ceil(n / PER_ROW) + 1); }

  function worldHeight(n, minHeight) {
    return Math.max(HEAD_ROOM + rowsNeeded(n) * ROW_H + FOOT_ROOM, minHeight || 0);
  }

  /* ---------------- 하객 배치 ---------------- */

  // 입장 순서(index)로 자리를 정한다. 같은 사람은 항상 같은 칸에 서고,
  // 나중에 누가 더 들어와도 기존 사람 자리는 바뀌지 않는다.
  // 실제 좌표는 여기(고정된 "제자리")에 wanderOffset()의 흔들림을 더해 완성된다.
  function homeFor(entry, index) {
    const S = global.PixelSprite;
    const row = Math.floor(index / PER_ROW);
    const lane = index % PER_ROW;
    const brick = (row % 2) ? 10 : 0;
    const rand = S.mulberry(S.hashString(String(entry.id || index)));
    const jx = Math.round((rand() - 0.5) * 10);
    const jy = Math.round((rand() - 0.5) * 12);
    return {
      x: LANES[lane] + brick + jx,
      y: HEAD_ROOM + row * ROW_H + jy,
      row,
    };
  }

  function layout(entries) {
    return entries.map((entry, index) => {
      const home = homeFor(entry, index);
      return { entry, id: entry.id, x: home.x, y: home.y, index };
    });
  }

  // 제자리에서 천천히 서성이는 움직임. id와 현재 시각만으로 계산되는
  // 결정론적 함수라 서버 없이도 모든 화면에서 같은 순간 같은 위치가 나온다.
  function wanderOffset(id, t) {
    const S = global.PixelSprite;
    const h = S.hashString(String(id) + ':wander');
    const fx = 0.00014 + ((h % 977) / 977) * 0.00016;
    const fy = 0.00010 + (((h >>> 3) % 613) / 613) * 0.00014;
    const px = ((h >>> 6) % 6283) / 1000;
    const py = ((h >>> 9) % 6283) / 1000;
    const ax = 5 + (h % 6);
    const ay = 3 + ((h >>> 2) % 4);
    return {
      dx: Math.sin(t * fx + px) * ax,
      dy: Math.sin(t * fy + py) * ay,
    };
  }

  // 메시지가 있는 하객이 이따금 말풍선을 스스로 띄우는 주기. id마다 주기·오프셋이
  // 달라 겹치지 않는다. phase가 0에 가까울수록 "방금 시작한" 말풍선이라
  // 화면엔 항상 phase가 가장 작은 하나만 골라서 보여준다(한꺼번에 우르르 뜨는 것 방지).
  function bubbleWindow(id, t) {
    const S = global.PixelSprite;
    const h = S.hashString(String(id) + ':bubble');
    const period = 22000 + (h % 20000);
    const duration = 3400 + (h % 1200);
    const offset = (h >>> 4) % period;
    const phase = (t + offset) % period;
    return { active: phase < duration, phase };
  }

  /* ---------------- 배경 그리기 ---------------- */

  function drawGrass(ctx, h, rand) {
    ctx.fillStyle = GRASS[0];
    ctx.fillRect(0, 0, WORLD_W, h);
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < WORLD_W; x += 2) {
        const r = rand();
        if (r < 0.22) { ctx.fillStyle = GRASS[1]; ctx.fillRect(x, y, 2, 1); }
        else if (r < 0.34) { ctx.fillStyle = GRASS[2]; ctx.fillRect(x, y, 1, 2); }
        else if (r < 0.38) { ctx.fillStyle = GRASS[3]; ctx.fillRect(x, y + 1, 2, 1); }
      }
    }
  }

  function drawPath(ctx, h, rand) {
    ctx.fillStyle = PATH[0];
    ctx.fillRect(AISLE_X, PATH_TOP, AISLE_W, h - PATH_TOP);
    for (let y = PATH_TOP; y < h; y += 2) {
      for (let x = AISLE_X; x < AISLE_X + AISLE_W; x += 2) {
        const r = rand();
        if (r < 0.18) { ctx.fillStyle = PATH[1]; ctx.fillRect(x, y, 2, 1); }
        else if (r < 0.28) { ctx.fillStyle = PATH[2]; ctx.fillRect(x, y + 1, 1, 1); }
      }
    }
    ctx.fillStyle = '#c9b892';
    ctx.fillRect(AISLE_X - 1, PATH_TOP, 1, h - PATH_TOP);
    ctx.fillRect(AISLE_X + AISLE_W, PATH_TOP, 1, h - PATH_TOP);
    ctx.fillStyle = '#d8c6a0';
    for (let y = PATH_TOP + 10; y < h; y += 16) {
      ctx.fillRect(AISLE_X + 3, y, 2, 2);
      ctx.fillRect(AISLE_X + AISLE_W - 5, y, 2, 2);
    }
  }

  function flower(ctx, x, y, petal) {
    ctx.fillStyle = petal;
    ctx.fillRect(x, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1);
    ctx.fillRect(x, y + 2, 1, 1); ctx.fillRect(x + 2, y + 2, 1, 1);
    ctx.fillStyle = '#f2d66a';
    ctx.fillRect(x + 1, y + 1, 1, 1);
  }

  function bush(ctx, x, y, w, h) {
    ctx.fillStyle = '#3f6b39';
    ctx.fillRect(x, y + 1, w, h - 1);
    ctx.fillRect(x + 1, y, w - 2, 1);
    ctx.fillStyle = '#4e7f44';
    ctx.fillRect(x + 1, y + 1, w - 3, 2);
    ctx.fillStyle = '#5e9150';
    ctx.fillRect(x + 2, y + 1, 2, 1);
    ctx.fillRect(x + w - 4, y + 3, 2, 1);
  }

  function tree(ctx, x, y) {
    ctx.fillStyle = '#6b4a30';
    ctx.fillRect(x + 3, y + 8, 3, 7);
    ctx.fillStyle = '#3f6b39';
    ctx.fillRect(x, y, 9, 9);
    ctx.fillRect(x + 1, y - 2, 7, 3);
    ctx.fillStyle = '#4e7f44';
    ctx.fillRect(x + 1, y + 1, 4, 4);
    ctx.fillStyle = '#5e9150';
    ctx.fillRect(x + 2, y + 2, 2, 2);
  }

  function bench(ctx, x, y) {
    ctx.fillStyle = '#8a6a45';
    ctx.fillRect(x, y, 12, 2);
    ctx.fillRect(x, y - 4, 12, 2);
    ctx.fillStyle = '#5c4530';
    ctx.fillRect(x, y + 2, 2, 3);
    ctx.fillRect(x + 10, y + 2, 2, 3);
  }

  function drawDecor(ctx, h, rand) {
    const petals = ['#f0f0ee', '#f2a8bc', '#efd28a', '#d9b6e8'];
    for (let y = PATH_TOP + 4; y < h - 8; y += 5) {
      for (const band of [[1, 90], [148, 236]]) {
        if (rand() < 0.5) {
          const x = band[0] + Math.floor(rand() * (band[1] - band[0]));
          flower(ctx, x, y, petals[Math.floor(rand() * petals.length)]);
        }
      }
    }
    for (let y = 60; y < h - 20; y += 46) {
      if (rand() < 0.7) bush(ctx, 1 + Math.floor(rand() * 6), y, 13, 9);
      if (rand() < 0.7) bush(ctx, 224 + Math.floor(rand() * 5), y + 16, 13, 9);
      if (rand() < 0.4) tree(ctx, 2 + Math.floor(rand() * 4), y + 26);
      if (rand() < 0.4) tree(ctx, 220 + Math.floor(rand() * 8), y + 4);
      if (rand() < 0.3) bench(ctx, 6 + Math.floor(rand() * 10), y + 20);
      if (rand() < 0.3) bench(ctx, 214 + Math.floor(rand() * 10), y + 34);
    }
    // 버진로드 양옆 화단
    for (let y = PATH_TOP + 2; y < h; y += 7) {
      flower(ctx, AISLE_X - 5, y, petals[Math.floor(rand() * petals.length)]);
      flower(ctx, AISLE_X + AISLE_W + 2, y + 3, petals[Math.floor(rand() * petals.length)]);
    }
  }

  function drawArch(ctx) {
    const span = 68;
    const x0 = CX - span / 2;
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(x0, ARCH_TOP, 4, ALTAR_Y - ARCH_TOP);
    ctx.fillRect(x0 + span - 4, ARCH_TOP, 4, ALTAR_Y - ARCH_TOP);
    ctx.fillStyle = '#d9d3c6';
    ctx.fillRect(x0 + 3, ARCH_TOP, 1, ALTAR_Y - ARCH_TOP);
    ctx.fillRect(x0 + span - 1, ARCH_TOP, 1, ALTAR_Y - ARCH_TOP);
    for (let i = 0; i <= span; i++) {
      const y = ARCH_TOP - Math.round(Math.sin((i / span) * Math.PI) * 15);
      ctx.fillStyle = '#f4f1ea';
      ctx.fillRect(x0 + i, y, 1, 5);
    }
    const petals = ['#f2a8bc', '#f0f0ee', '#efd28a', '#e8849c'];
    let s = 1337;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i <= span; i += 3) {
      const y = ARCH_TOP - Math.round(Math.sin((i / span) * Math.PI) * 15) - 2;
      ctx.fillStyle = petals[Math.floor(rnd() * petals.length)];
      ctx.fillRect(x0 + i, y, 2, 2);
      if (rnd() < 0.4) { ctx.fillStyle = '#4e7f44'; ctx.fillRect(x0 + i + 1, y + 2, 1, 1); }
    }
    ctx.fillStyle = '#4e7f44';
    ctx.fillRect(x0 - 1, 74, 6, 3);
    ctx.fillRect(x0 + span - 5, 78, 6, 3);
    // 단상
    ctx.fillStyle = '#e0d2b4';
    ctx.fillRect(CX - 30, ALTAR_Y, 60, 6);
    ctx.fillStyle = '#cbbb98';
    ctx.fillRect(CX - 30, ALTAR_Y + 5, 60, 1);
  }

  // 배경(잔디/버진로드/장식/아치)만 그린다. 하객·신랑신부는 매 프레임 별도로 그려진다.
  function renderBackground(cache, entryCount, minHeight) {
    const S = global.PixelSprite;
    const h = Math.round(worldHeight(entryCount, minHeight));
    let cv = cache.canvas;
    if (!cv) { cv = cache.canvas = document.createElement('canvas'); }
    if (cv.width !== WORLD_W || cv.height !== h) { cv.width = WORLD_W; cv.height = h; }
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const rand = S.mulberry(9271);
    drawGrass(ctx, h, rand);
    drawPath(ctx, h, rand);
    drawDecor(ctx, h, rand);
    drawArch(ctx);
    cache.height = h;
    return cache;
  }

  // 신랑신부의 현재 위치(제자리 서성임 포함). couple이 없으면 기본 캐릭터.
  function couplePositions(couple, t) {
    const pair = couple || DEFAULT_COUPLE;
    const lw = wanderOffset('__groom', t * 0.4);
    const rw = wanderOffset('__bride', t * 0.4);
    return [
      pair.left && { attrs: pair.left, x: 90 + lw.dx * 0.3, y: ALTAR_Y - SPRITE_H + lw.dy * 0.2 },
      pair.right && { attrs: pair.right, x: 118 + rw.dx * 0.3, y: ALTAR_Y - SPRITE_H + rw.dy * 0.2 },
    ].filter(Boolean);
  }

  global.PixelWorld = {
    WORLD_W, SPRITE_W, SPRITE_H, HEAD_ROOM, ROW_H, AISLE_X, AISLE_W, ALTAR_Y, DEFAULT_COUPLE,
    worldHeight, layout, homeFor, wanderOffset, bubbleWindow, renderBackground, couplePositions,
  };
})(window);
