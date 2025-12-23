---
tag: excalidraw-script
---
/*
Arc by Angle (ultra-stable, no bring-to-front)

- 高清圆弧
- 最粗/最平滑线条
- 视口中心生成
- 不做置顶，最大限度避免崩溃

```javascript
*/
(async function () {
  'use strict';

  const ea = ExcalidrawAutomate;
  ea.reset();
  ea.setView("active");

  // 1) 输入角度
  let angleDegStr = await utils.inputPrompt("Arc angle (degrees)?", "number", "60");
  if (!angleDegStr) return;

  let angleDeg = parseFloat(angleDegStr);
  if (isNaN(angleDeg) || angleDeg <= 0) {
    new Notice("请输入一个 > 0 的角度（度）");
    return;
  }
  if (angleDeg >= 360) angleDeg = 359.999;

  // 2) 采样参数
  const R = 100;
  const stepDeg = 1.5;   // 1~2 很圆且轻量
  const MAX_POINTS = 240;
  let steps = Math.ceil(angleDeg / stepDeg);
  steps = Math.min(steps, MAX_POINTS - 1);
  const theta = angleDeg * Math.PI / 180;

  // 3) 视口中心
  const api = ea.getExcalidrawAPI();
  const st = api.getAppState();
  const zoom = st.zoom?.value ?? 1;
  const centerX = (-st.scrollX + st.width / 2) / zoom;
  const centerY = (-st.scrollY + st.height / 2) / zoom;

  // 4) 生成点
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = theta * (i / steps);
    pts.push([
      centerX + R * Math.cos(t),
      centerY + R * Math.sin(t),
    ]);
  }

  // 5) 样式
  ea.style.strokeWidth = 4;
  ea.style.roughness = 0;
  ea.style.strokeStyle = "solid";
  ea.style.startArrowHead = null;
  ea.style.endArrowHead = null;

  // 6) 画弧线并写入画布
  ea.addLine(pts);
  await ea.addElementsToView();

})();
