/* ============================================================
 * appearance.js — 人物立绘 / 手持武器外观（只读展示）
 *
 * 设计画布固定 955×1368（与源 PNG 相同），人物与武器共用同一
 * 内部坐标系，整张画布作为整体等比适配 .char-figure，避免两者
 * 各自 contain 后缩放错位。
 *
 * 装备状态只读自 state.equipped（唯一数据源），不创建第二套状态，
 * 不读 DOM 文本，不轮询。调用入口：
 *   - app.js render()        —— 初始化 / 撤销 / AI 起装提交后
 *   - app.js refreshSlot()   —— 拖拽装备、替换、卸下、双击后
 *
 * 武器素材按物品的 wpn 类型键精确映射（AKM / AKMN / AK-74N / MP5），
 * 不使用中文名模糊匹配，不修改物品实例 ID。
 * ============================================================ */

const CHARACTER_APPEARANCE = {
  canvas: { w: 955, h: 1368 },
  base: "assets/character/operator_ying_base.png",
  /* 每把枪独立配置：
   *   src     武器 PNG（与原图同 955×1368 画布，带 alpha）
   *   anchor  武器握把在设计画布中的锚点 [x, y]
   *   x, y    锚点要落到的画布位置（右手握把位置）
   *   scale   等比缩放
   *   rot     顺时针旋转（度）
   *   flip    是否水平翻转（在锚点处镜像）
   *   z       图层顺序
   * 调参时只改本表；人物/武器/坐标均以 955×1368 设计画布为单位，
   * 与浏览器窗口大小无关。 */
  weapons: {
    "AKM": {
      src: "assets/character/weapon_akm.png",
      anchor: [390, 535], x: 450, y: 505,
      scale: 0.903, rot: 14.6, flip: false, z: 3
    },
    "AK-74N": {
      src: "assets/character/weapon_ak74n.png",
      anchor: [390, 545], x: 450, y: 505,
      scale: 0.889, rot: 14.4, flip: false, z: 3
    },
    "AKMN": {
      src: "assets/character/weapon_akmn.png",
      anchor: [405, 555], x: 450, y: 505,
      scale: 0.903, rot: 14.6, flip: false, z: 3
    },
    "MP5": {
      src: "assets/character/weapon_mp5.png",
      anchor: [400, 545], x: 445, y: 500,
      scale: 0.830, rot: 0, flip: false, z: 3
    }
  }
};

/* 同一把未配置外观的武器只提示一次 */
const _appearanceWarned = new Set();
/* 图片竞态令牌：只有最后一次请求的 onload 允许显示 */
let _appearanceToken = 0;
/* 当前已提交到 DOM 的外观 key，避免无关刷新反复重载同一把枪 */
let _appearanceKey = "";

function appearanceConfigForItem(item) {
  if (!item) return null;
  const key = item.wpn;
  if (!key || !Object.prototype.hasOwnProperty.call(CHARACTER_APPEARANCE.weapons, key)) return null;
  return CHARACTER_APPEARANCE.weapons[key];
}

/* 没有专用手持图时的回退：用物品自身缩略图，套一组通用步枪对位参数。
 * 专用图坐标系是 955×1368 整画布；物品缩略图是 512×512 透明画布（武器内容横向、留透明边），
 * 故 scale 取较小值让其落在右手附近。只保证“手中有枪、随物品切换”，精细对位仍应补专用图。 */
const FALLBACK_WEAPON_CFG = {
  anchor: [400, 545], x: 450, y: 505,
  scale: 0.42, rot: 12, flip: false, z: 3, fallback: true
};
/* 取物品缩略图（经 window.ItemImages；模块不强依赖，缺失时返回 null，不报错） */
function itemThumbSrc(item) {
  try {
    if (typeof window !== "undefined" && window.ItemImages && typeof window.ItemImages.itemImage === "function") {
      return window.ItemImages.itemImage(item) || null;
    }
  } catch (e) { /* 测试或无图环境：安全回退 */ }
  return null;
}
/* 专用配置优先；否则有物品缩略图 → 回退配置；都没有 → null（隐藏手持枪） */
function appearanceConfigWithFallback(item) {
  const cfg = appearanceConfigForItem(item);
  if (cfg) return { config: cfg, fallback: false };
  if (!item) return { config: null, fallback: false };
  const src = itemThumbSrc(item);
  if (!src) return { config: null, fallback: false };
  return { config: Object.assign({}, FALLBACK_WEAPON_CFG, { src: src }), fallback: true };
}

/* 解析当前应显示的武器：主武器优先；主武器为空才考虑副武器；
 * 已装备但无外观配置时返回 config:null（隐藏武器层，不回退到另一槽）。 */
function resolveCharacterAppearance(state) {
  const equipped = state && state.equipped ? state.equipped : null;
  if (!equipped) return { slot: "", item: null, key: "", config: null };
  const order = ["primary", "secondary"];
  for (let i = 0; i < order.length; i++) {
    const slot = order[i];
    const item = equipped[slot] && equipped[slot].item;
    if (!item) continue;
    const got = appearanceConfigWithFallback(item);
    return {
      slot: slot,
      item: item,
      key: item.wpn || "",
      config: got.config,
      fallback: got.fallback
    };
  }
  return { slot: "", item: null, key: "", config: null, fallback: false };
}

function warnAppearanceOnce(key, item) {
  const tag = key || "(无 wpn)";
  if (_appearanceWarned.has(tag)) return;
  _appearanceWarned.add(tag);
  const name = item && (item.baseName || item.name);
  console.warn("[QM-01][appearance] 已装备武器未配置立绘外观，已隐藏武器层：" +
    tag + (name ? " / " + name : ""));
}

function warnAppearanceLoadOnce(key, src) {
  const tag = "load:" + key;
  if (_appearanceWarned.has(tag)) return;
  _appearanceWarned.add(tag);
  console.warn("[QM-01][appearance] 外观图片加载失败：" + src);
}

function applyAppearanceTransform(img, cfg) {
  const cw = CHARACTER_APPEARANCE.canvas.w;
  const ch = CHARACTER_APPEARANCE.canvas.h;
  const ax = cfg.anchor[0];
  const ay = cfg.anchor[1];
  const dx = cfg.x - ax;
  const dy = cfg.y - ay;
  img.style.transformOrigin = (ax / cw * 100) + "% " + (ay / ch * 100) + "%";
  img.style.transform =
    "translate(" + (dx / cw * 100) + "%, " + (dy / ch * 100) + "%)" +
    " rotate(" + cfg.rot + "deg)" +
    " scale(" + cfg.scale + ")" +
    (cfg.flip ? " scaleX(-1)" : "");
  img.style.zIndex = String(cfg.z || 3);
}

function hideAppearanceWeapon(img, stage) {
  _appearanceToken++;
  _appearanceKey = "";
  if (img) {
    img.onload = null;
    img.onerror = null;
    img.style.display = "none";
    img.removeAttribute("src");
    img.dataset.weaponKey = "";
  }
  if (stage) stage.dataset.weaponKey = "";
}

/* 唯一入口：任何装备变化提交后调用；只改显示，不写 state。 */
function renderCharacterAppearance(state) {
  const stage = document.getElementById("charStage");
  if (!stage) return;
  const img = document.getElementById("charWeapon");
  const resolved = resolveCharacterAppearance(state);

  if (!resolved.config) {
    hideAppearanceWeapon(img, stage);
    // 既无专用图也无物品缩略图：空槽=empty；有物品但彻底无图=unsupported（仍隐藏，不留旧枪）
    stage.dataset.weaponState = resolved.item ? "unsupported" : "empty";
    if (resolved.item) warnAppearanceOnce(resolved.key, resolved.item);
    return;
  }

  const cfg = resolved.config;
  // 回退图不同物品可能同 wpn/无 wpn，用 src 参与去重，避免切枪后仍显示上一把
  const key = resolved.fallback ? ("fb:" + cfg.src) : resolved.key;
  stage.dataset.weaponKey = resolved.key;
  if (!img) return;

  /* 同一把枪已提交过（加载中或已显示）就不重复加载，避免无关刷新闪烁 */
  if (_appearanceKey === key && img.getAttribute("src") === cfg.src) return;

  const token = ++_appearanceToken;
  _appearanceKey = key;

  /* 先隐藏旧枪，再换新图；旧图 onload 由 token 丢弃 */
  img.style.display = "none";
  img.onload = null;
  img.onerror = null;
  applyAppearanceTransform(img, cfg);
  img.dataset.weaponKey = key;
  stage.dataset.weaponState = "loading";

  // 先绑定回调再设 src：命中浏览器缓存的图片可能同步触发 onload，
  // 必须保证回调已就位（也让无异步 Image 的测试环境能即时取到显示态）。
  img.onload = function () {
    if (token !== _appearanceToken) return;
    img.style.display = "block";
    stage.dataset.weaponState = resolved.fallback ? "ready-fallback" : "ready";
  };
  img.onerror = function () {
    if (token !== _appearanceToken) return;
    img.style.display = "none";
    stage.dataset.weaponState = "error";
    warnAppearanceLoadOnce(key, cfg.src);
  };
  img.setAttribute("src", cfg.src);
}

/* 空闲时预取四把枪，减少切枪首帧等待；测试环境无 Image 时直接跳过 */
function preloadCharacterAppearance() {
  if (typeof Image !== "function") return;
  const list = CHARACTER_APPEARANCE.weapons;
  Object.keys(list).forEach(function (k) {
    const im = new Image();
    im.decoding = "async";
    im.src = list[k].src;
  });
}

if (typeof window !== "undefined") {
  window.QMAppearance = {
    config: CHARACTER_APPEARANCE,
    resolve: resolveCharacterAppearance,
    render: renderCharacterAppearance
  };
  if (typeof window.setTimeout === "function") {
    window.setTimeout(preloadCharacterAppearance, 0);
  }
}
