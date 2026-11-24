/* item-images.js — 物品视觉图映射（只读映射，不含任何价格/规则）
 * 键：data.js 模板中文名（含 ×数量 堆叠变体）；值：缩略图相对路径（相对 index.html）。
 * 原图在 assets/items，缩略图在 assets/items/thumbs（make_thumbs.js 生成，最长边 512，保 alpha）。
 * 文件名含空格/中文，统一 encodeURI。带 “-1” 的重复变体不引用。
 * 规则：精确名 → 基础名归一（去 ×N、去所有空格）。查不到返回 null，由渲染层回退文字。
 */
(function (global) {
  "use strict";
  var DIR = "assets/items/thumbs/";

  // 仅需“显式纠偏”的映射（文件名与模板名不能仅靠去空格/去×N 对上时）。
  // 目前补图后所有物品都能靠基础名归一命中，此表保留为空，规则对全部 47 个有图模板生效。
  var ALIAS = {
    // 例："某模板名": "实际缩略图文件名（不含 .png）"
  };

  // 启动时枚举缩略图目录里真实存在的文件名（构建 基础名 -> 文件名 表），
  // 这样新增原图+重跑 make_thumbs 后无需改本文件即可自动命中。
  var NAME_INDEX = [];
  try {
    if (global.ITEM_IMAGE_FILES && global.ITEM_IMAGE_FILES.length) NAME_INDEX = global.ITEM_IMAGE_FILES.slice();
  } catch (e) { NAME_INDEX = []; }

  function norm(s) { return String(s == null ? "" : s).replace(/×\d+$/g, "").replace(/\s+/g, ""); }
  function enc(file) { return DIR + file.split("/").map(encodeURIComponent).join("/"); }

  var byBase = null;
  function buildIndex() {
    byBase = Object.create(null);
    NAME_INDEX.forEach(function (f) {
      var stem = f.replace(/\.png$/i, "");
      if (/-\d+$/.test(stem)) return; // 跳过 “AKM 突击步枪-1” 这类重复变体
      byBase[norm(stem)] = f;
    });
  }

  /* 注册真实缩略图文件名（由 index.html 注入或测试注入）；可重复调用覆盖 */
  function register(files) {
    NAME_INDEX = (files || []).slice();
    byBase = null;
  }

  /* 返回 encodeURI 后的相对路径；无图返回 null */
  function itemImage(it) {
    if (!it) return null;
    var name = it.baseName || it.name;
    if (!name) return null;
    if (Object.prototype.hasOwnProperty.call(ALIAS, name) && ALIAS[name]) {
      var f = ALIAS[name] + ".png";
      return enc(f);
    }
    if (byBase === null) buildIndex();
    var hit = byBase[norm(name)];
    return hit ? enc(hit) : null;
  }

  /* 面积 ≥4 才显示格底名称条（与显示规则一致），供渲染层判断 */
  function showName(it) {
    var w = it && (it.w || 1), h = it && (it.h || 1);
    // 旋转后占格交换
    if (it && it.rot % 2 === 1) { var t = w; w = h; h = t; }
    return (w * h) >= 4;
  }

  var ItemImages = { itemImage: itemImage, showName: showName, register: register, dir: DIR };
  global.ItemImages = ItemImages;
  if (typeof module !== "undefined" && module.exports) module.exports = ItemImages;
})(typeof window !== "undefined" ? window : this);
