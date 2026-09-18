// 업로드한 사진에서 얼굴 영역을 찾아 피부톤/머리색/옷 색을 추출하고
// 픽셀 캐릭터 속성으로 변환한다. 서버·모델 없이 캔버스 픽셀만으로 동작.
(function (global) {
  const MAX_SIDE = 220;

  function isSkin(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 50 || max > 250) return false;
    if (max - min < 12) return false;
    if (!(r > g && g >= b)) return false;
    if (r - g < 10 || r - b < 18) return false;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    return y > 55 && cb > 72 && cb < 132 && cr > 132 && cr < 180;
  }

  async function loadBitmap(file) {
    if (global.createImageBitmap) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) { /* 아래 <img> 경로로 폴백 */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  function toImageData(bmp) {
    const w = bmp.width, h = bmp.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, cw, ch);
    return ctx.getImageData(0, 0, cw, ch);
  }

  function pixelAt(img, x, y) {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }

  // 16단계로 양자화해 최빈 버킷을 찾고, 그 버킷 픽셀의 평균색을 돌려준다.
  function dominantColor(samples) {
    if (!samples.length) return null;
    const buckets = new Map();
    for (const [r, g, b] of samples) {
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      let e = buckets.get(key);
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, e); }
      e.n++; e.r += r; e.g += g; e.b += b;
    }
    let best = null;
    for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
    return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
  }

  function medianColor(samples) {
    if (!samples.length) return null;
    const ch = [0, 1, 2].map((c) => samples.map((s) => s[c]).sort((a, b) => a - b));
    const mid = Math.floor(samples.length / 2);
    return [ch[0][mid], ch[1][mid], ch[2][mid]];
  }

  function toHex([r, g, b]) {
    return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  function lumaOf([r, g, b]) { return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

  function dist(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  }

  function findFace(img) {
    const w = img.width, h = img.height;
    const xs = [], ys = [];
    const limit = Math.round(h * 0.8); // 얼굴은 보통 위쪽에 있다
    for (let y = 0; y < limit; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = pixelAt(img, x, y);
        if (isSkin(r, g, b)) { xs.push(x); ys.push(y); }
      }
    }
    if (xs.length < w * h * 0.004) return null;
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.floor((arr.length - 1) * p)];
    // 손·배경 오탐을 잘라내기 위해 사분위로 범위를 좁힌다
    let x0 = q(xs, 0.12), x1 = q(xs, 0.88), y0 = q(ys, 0.08), y1 = q(ys, 0.92);
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function sampleRegion(img, x0, y0, x1, y1, filter) {
    const out = [];
    const xs = Math.max(0, Math.round(x0)), xe = Math.min(img.width - 1, Math.round(x1));
    const ys = Math.max(0, Math.round(y0)), ye = Math.min(img.height - 1, Math.round(y1));
    for (let y = ys; y <= ye; y++) {
      for (let x = xs; x <= xe; x++) {
        const p = pixelAt(img, x, y);
        if (!filter || filter(p)) out.push(p);
      }
    }
    return out;
  }

  function nearestPalette(rgb, palette) {
    let best = palette[0], bd = Infinity;
    for (const hex of palette) {
      const p = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      const d = dist(rgb, p);
      if (d < bd) { bd = d; best = hex; }
    }
    return best;
  }

  function analyzeImageData(img) {
    const S = global.PixelSprite;
    const face = findFace(img);
    const result = { detected: !!face };

    const fallbackSkin = S.SKINS[1];
    if (!face) {
      // 얼굴을 못 찾으면 화면 중앙 상단/하단으로 대략 추정
      const topRegion = sampleRegion(img, img.width * 0.25, img.height * 0.05, img.width * 0.75, img.height * 0.3);
      const bodyRegion = sampleRegion(img, img.width * 0.2, img.height * 0.45, img.width * 0.8, img.height * 0.8);
      result.skin = fallbackSkin;
      result.hairColor = nearestPalette(dominantColor(topRegion) || [40, 30, 25], S.HAIR_COLORS);
      result.topColor = toHex(dominantColor(bodyRegion) || [60, 65, 75]);
      result.longHair = false;
      return result;
    }

    const cx = face.x + face.w / 2;
    const skinSamples = sampleRegion(img, face.x, face.y + face.h * 0.25, face.x + face.w, face.y + face.h * 0.85,
      (p) => isSkin(p[0], p[1], p[2]));
    const skinRgb = medianColor(skinSamples) || [230, 190, 160];
    result.skin = nearestPalette(skinRgb, S.SKINS);

    // 머리카락: 얼굴 상단 위쪽 띠에서 피부가 아닌 색
    const hairSamples = sampleRegion(img, face.x - face.w * 0.15, Math.max(0, face.y - face.h * 0.45),
      face.x + face.w * 1.15, face.y + face.h * 0.12,
      (p) => !isSkin(p[0], p[1], p[2]) && dist(p, skinRgb) > 38);
    const hairRgb = dominantColor(hairSamples) || [40, 30, 25];
    result.hairColor = nearestPalette(hairRgb, S.HAIR_COLORS);

    // 상의: 어깨~가슴 높이의 중앙 영역
    const topSamples = sampleRegion(img, cx - face.w * 1.1, face.y + face.h * 1.35, cx + face.w * 1.1, face.y + face.h * 2.4,
      (p) => !isSkin(p[0], p[1], p[2]));
    const topRgb = dominantColor(topSamples);
    result.topColor = topRgb ? toHex(topRgb) : '#39404d';

    // 긴 머리 판정: 얼굴 옆·아래 바깥쪽에 머리색과 비슷한 픽셀이 얼마나 있나.
    // 머리색과 옷 색이 비슷하면(둘 다 검정 등) 구분이 불가능하므로 짧은 머리로 둔다.
    const sideBandY0 = face.y + face.h * 0.9;
    const sideBandY1 = face.y + face.h * 1.9;
    const sideSamples = [
      ...sampleRegion(img, face.x - face.w * 0.55, sideBandY0, face.x - face.w * 0.05, sideBandY1),
      ...sampleRegion(img, face.x + face.w * 1.05, sideBandY0, face.x + face.w * 1.55, sideBandY1),
    ];
    const hairish = sideSamples.filter((p) => dist(p, hairRgb) < 46).length;
    const tellApart = !topRgb || dist(hairRgb, topRgb) > 48;
    result.longHair = tellApart && sideSamples.length > 0 && hairish / sideSamples.length > 0.32;

    // 하의: 프레임에 잡혔을 때만
    const bottomSamples = sampleRegion(img, cx - face.w * 0.9, face.y + face.h * 3.2, cx + face.w * 0.9, face.y + face.h * 4.4,
      (p) => !isSkin(p[0], p[1], p[2]));
    const bottomRgb = bottomSamples.length > 40 ? dominantColor(bottomSamples) : null;
    result.bottomColor = bottomRgb ? toHex(bottomRgb) : null;
    result.faceBox = face;
    return result;
  }

  // 분석 결과 + 시드로 서로 다른 후보 캐릭터를 만든다. 색(=닮은 정도)은 유지하고
  // 헤어스타일·의상 같은 해석 여지가 있는 부분만 바꾼다.
  function attrsFromAnalysis(a, seed) {
    const S = global.PixelSprite;
    const rand = S.mulberry(S.hashString(String(seed)));
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];

    const longStyles = ['long', 'wavyLong', 'bob', 'ponytail', 'halfUp', 'medium'];
    const shortStyles = ['short', 'sideSwept', 'middlePart', 'buzz', 'curly', 'medium'];
    const hairStyle = pick(a.longHair ? longStyles : shortStyles);

    const topL = S.luma(a.topColor || '#39404d');
    const darkOutfits = ['suit', 'jacket', 'coat', 'knit'];
    const lightOutfits = ['shirt', 'blouse', 'knit', 'jacket'];
    let outfit = pick(topL < 0.35 ? darkOutfits : lightOutfits);
    if (a.longHair && rand() < 0.25) outfit = 'dress';

    const bottom = a.bottomColor || S.shade(a.topColor || '#39404d', topL > 0.6 ? -0.55 : -0.2);

    return S.normalize({
      skin: a.skin,
      hairColor: a.hairColor,
      hairStyle,
      outfit,
      topColor: a.topColor,
      innerColor: topL < 0.4 ? '#f0f0ee' : S.shade(a.topColor, 0.45),
      bottomColor: bottom,
      shoeColor: rand() < 0.5 ? '#1d1f24' : '#e8e6e2',
      accentColor: pick(['#8a4a52', '#2b3550', '#4a6b52', '#7a5a33']),
      accessory: a.accessory || 'none',
      blush: rand() < 0.35,
      seed: Math.floor(rand() * 100000),
    });
  }

  async function analyzeFile(file) {
    const bmp = await loadBitmap(file);
    const img = toImageData(bmp);
    if (bmp.close) bmp.close();
    return analyzeImageData(img);
  }

  global.PhotoAnalyzer = { analyzeFile, analyzeImageData, attrsFromAnalysis, toImageData, loadBitmap };
})(window);
