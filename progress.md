# 进展与踩坑记录

## 火车"秒针"卡顿 + 天空乱线（2026-06-10）

### 背景：为什么火车不能 16ms 更新

两个**独立**根因，都要修：

1. **AMap 矢量覆盖物被节流**：`AMap.Polyline`/Marker 的重绘会被合并进地图自己的节流渲染循环。即使每 16ms 调 `setPath()`，AMap 也不会每帧真重绘（静止时约 1Hz）。**改 setTimeout/rAF 的循环间隔完全无效**，瓶颈在 AMap 内部。
   → 解决：火车 + 轨道不再用 AMap 覆盖物，改画到**自管的 WebGL overlay canvas**（`src/layers/gl-overlay.js`），自己跑 rAF。实测 ~48fps 重绘。

2. **仿真时间被量化成整数秒**：`src/clock.js` 的 `minutesOfDay()` 原来用 `getSeconds()`，丢掉毫秒，导致 `snapshot()` 一秒才给一个新位置。即便画布 60fps 也只动一次。
   → 解决：`minutesOfDay` 加上 `getMilliseconds()/1000`。

两者都修后，列车才真正每帧平滑前进（实测 23 帧里 22 帧在动）。

### ⚠️ 高频坑：天空里的乱线（已犯过多次，务必避免）

**现象**：3D 俯仰视角下，深圳路网上方的蓝天里挂着一堆横跨画面、射向天空的斜向彩色直线。

**原因**：overlay 方案需要每帧用 `map.lngLatToContainer(经纬度)` 把经纬度投影成屏幕像素再连线。在 3D 俯仰视角下，**位于相机背后的点**在透视投影里没有意义（数学上 `w ≤ 0` 会翻折），但 `lngLatToContainer` 不报错，照样返回有限数值——实测这些点的 `y` 会变成 **几十万到两百多万像素**的天文数字。一旦把可见点和这种垃圾点连成线段，就画出射向天空的乱线。

**解决方案**（已验证有效，pitch 73 下天空全干净）：
1. 实测发现 `map.getBounds().contains(lngLat)` 对相机背后的垃圾点 **100% 返回 false**（258 个垃圾点零漏网），是干净的裁剪判据。
2. 投影时：`if (!bounds.contains(ll)) 该点记为 null`。每帧取一次 `map.getBounds()`。
3. overlay 的 `addLine` 遇到 `null` 就**断开折线**——既不连线段，也不画该点的接头圆点。

涉及文件：`src/layers/gl-overlay.js`（断线逻辑）、`src/layers/line-layer.js`、`src/layers/train-layer.js`（投影时裁剪）。

**教训**：动 overlay 投影前，先在浏览器里实测 `lngLatToContainer` 对地平线外/相机背后点的返回值，确认裁剪判据，别凭猜直接连线。

## 列车做成 3D 立方体（2026-06-10）

列车从扁平条带改成 3D 长方体（每节车厢一个盒子），在自管 overlay 里用屏幕空间做伪 3D（不碰 AMap 的 3D 物体 API，避免重新引入节流）。期间踩了三个坑，都已修：

### ⚠️ 坑 1：盒子是歪斜的平行四边形

**原因**：整个盒子都在屏幕空间里造——车宽按"屏幕上垂直于轨道"偏移固定像素，车高按"屏幕正上方"偏移。这两个方向在屏幕上并不垂直，横截面被画成平行四边形，顶面成了一张歪斜的卡片。

**解决**：车厢底面足迹改到**地理坐标**里算——沿轨道在地面上向左右各偏移半个车宽（**米**），得到左右两条轨，再用 `lngLatToContainer` 分别投影。这样足迹随透视正确收缩，顶面变成真正的透视矩形。高度仍沿屏幕竖直挤出（世界竖直投影到屏幕本就是竖直，方向正确）。车宽设了最小屏幕像素下限，缩小时仍可见。见 `train-layer.js` 的 `_railsGeo`。

### ⚠️ 坑 2：遮挡关系全反了（远处盖住近处）

**原因**：overlay 没有深度缓冲，谁后画谁在上面。之前按车厢沿轨道顺序画，与屏幕远近无关。

**解决**：把所有列车的车厢收集起来，**按屏幕深度排序、远的先画近的后画**（俯仰视角下越远屏幕 y 越小）。对所有线路统一排序，顺带解决线路交叉处遮挡。见 `train-layer.js` 的 `draw`（`cars.sort` 按 depth）。

### ⚠️ 坑 3：立方体内部的背面也画出来，从缝隙透出

**原因**：盒子各面全画，背对相机的内壁会透出来。

**解决**：开启 WebGL **背面剔除**（`CULL_FACE`），只画朝向相机的外表面。轨道线三角形朝向不一致不能一起剔除，所以把 overlay 拆成两趟绘制：第一趟画轨道线（关剔除），第二趟画立方体面（开背面剔除）。盒子各面按一致的外向缠绕顺序输出。见 `gl-overlay.js` 的 `flush`（`_linePos`/`_solidPos` 双流 + `frontFace`/`cullFace`）。

**教训**：屏幕空间伪 3D 的两个方向（宽 vs 高）在屏幕上不垂直，足迹一定要在地理空间算；没有深度缓冲就必须自己做画家算法排序 + 背面剔除。

## 架构升级：切到真·3D 渲染（GLCustomLayer，2026-06-10）

上面那套 2D 屏幕空间 overlay 反复出问题——尤其 3D 俯视下「相机背后的点」被 `lngLatToContainer` 投影成几十万~几百万 px 的垃圾坐标，连出横穿全屏的**飞线**。用阈值/`bounds` 裁剪都是治标的 hack，会顾此失彼（要么飞线复活，要么高缩放下线段消失）。

**根因**：屏幕空间 overlay **根本没有深度、没有相机**——我把 3D 投影外包给 `lngLatToContainer`，它丢掉了裁剪空间的 `w` 符号，我没法知道点在相机背后。

**做法**：改用 `AMap.GLCustomLayer`，和地图**共享真实相机 MVP 矩阵 + 深度缓冲**（`map.customCoords.getMVPMatrix()` / `lngLatToCoord`），见 `src/layers/gl-scene.js`：

- 几何全部送**世界坐标**（米，东/北 + 向上的高度），由真实透视 MVP 变换。
- **相机背后由 GPU 近平面裁剪自动处理** → 飞线从原理上消失，不再需要任何裁剪 hack。
- **遮挡由深度缓冲自动处理** → 不再需要画家排序、背面剔除；列车是真·立方体（世界坐标足迹 + 高度挤出），内壁不会穿透。
- 线路用**屏幕等宽 + 斜接（miter join）**的 3D 线（`addPolyline`，顶点带 prev/next 邻居算斜接方向），转弯不再有锯齿；宽度 8px（高亮 12px）。
- 每帧主循环重建几何后调 `map.render()` 驱动 `GLCustomLayer.render()`，渲染与 rAF 1:1（不被 AMap 限流）。
- 旧的 `gl-overlay.js`（2D 屏幕空间）及其 culling/排序/裁剪补丁全部删除。

注意：`map.render()` 每帧会让 AMap 重绘整个 3D 场景，比旧的「上层 2D canvas」重；前台窗口可达屏幕刷新率，自动化/后台标签页会被浏览器 rAF 节流（与代码无关）。

### 两个坐标转换 API 的区别（务必分清）

这次重构的本质，就是从 `lngLatToContainer`（屏幕坐标）换成 `lngLatToCoord`（世界坐标）。两者一字之差，干的事完全不同：

| API | 输出 | 坐标系 | 投影在哪做 | 相机背后裁剪 |
|---|---|---|---|---|
| `map.lngLatToContainer` | `{x, y}` 像素 | **屏幕**（容器左上角为原点，x 右 / y 下） | AMap 内部一步投影到屏幕 | **无**（丢了裁剪空间的 `w` 符号） |
| `map.customCoords.lngLatToCoord` | `[x, y]` | **世界坐标**（米级，投影前） | 留给 GPU（顶点着色器里乘 MVP） | **GPU 近平面裁剪自动处理** |

- **旧 overlay** 用 `lngLatToContainer`：经纬度 → 屏幕像素 → 在 2D canvas 上连线。投影外包给了 AMap，它把 3D 压成 2D 时丢掉了 `w` 符号，所以**相机背后的点（`w ≤ 0`）会被返回成几十万~几百万 px 的垃圾坐标**，连出飞线。没有深度缓冲，遮挡/背面还得自己 hack。
- **新 scene** 用 `lngLatToCoord`：经纬度 → 世界坐标 `[x,y]`（高度 z 由调用方加），塞进顶点 buffer，**投影不在 JS 里做**，而是顶点着色器里 `gl_Position = u_mvp * vec4(a_pos, 1.0)`，`u_mvp` 来自 `customCoords.getMVPMatrix()`。因为投影留给了 GPU，近平面裁剪和深度测试都自动生效。

完整链路：

```
经纬度
  --customCoords.lngLatToCoord-->  世界坐标 [x,y]（米）      ← CPU（gl-scene.js 的 toWorld）
  --MVP 矩阵（顶点着色器里）-->     裁剪空间                 ← GPU
  --透视除法 + 近平面裁剪-->        屏幕                     ← GPU 免费
```

**一句话**：飞线消失不是因为换了画法，而是因为**投影那一步从 `lngLatToContainer`（外包给 AMap、丢 w）改回了 GPU 自己用 MVP 做（保留 w，能裁剪相机背后）**。

## 白色主题 + 灰白 3D 建筑（2026-06-10）

- 底图样式 `amap://styles/dark` → `amap://styles/light`；UI 面板/加载层等全部改为**白色、不透明**（移除 `backdrop-blur` 和 rgba 透明），见 `metro-3d.css` 与 `index.html`。
- 3D 建筑用 `AMap.Buildings` 图层（`map.js` 的 `_addBuildings`），灰白、**不透明**。
  - ⚠️ **AMap 颜色是 AARRGGBB（alpha 在最前）**。误当成 RRGGBBAA 会把 alpha 当颜色、颜色当 alpha → 建筑半透明发蓝。不透明灰白用 `'ffe9ebee'`（顶）/`'ffc2c6cc'`（墙）。
  - 建筑只在 zoom≥15 才被 AMap 挤出，城市全景下看不到，正常。
