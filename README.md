# Metro 3D · 深圳地铁

实时 3D 数字地铁地图，灵感来自 [mini-tokyo-3d](https://minitokyo3d.com/)。在高德 3D 底图之上，按真实运营时刻和发车间隔模拟全网列车，并以 60fps 平滑运行。

![深圳地铁 3D 实时地图](docs/screenshot.png)

## 特性

- **真实时间运行**：仿真时钟始终跟随真实墙钟（1×），列车只在线路实际运营时段内行驶。
- **60fps 平滑动画**：列车与轨道绘制在自管的 WebGL 覆盖层上，自跑 `requestAnimationFrame`，绕开高德矢量覆盖物的节流重绘。
- **3D 立方体列车**：每节车厢渲染为带顶/侧/端面的 3D 长方体，6 节编组，随缩放和俯仰正确透视、遮挡、背面剔除。
- **官方配色**：线路使用深圳地铁官方色板。
- **交互**：滚轮缩放，`⌘`+拖动调整俯仰，`⇧`+拖动旋转视角；左侧面板高亮 / 显隐线路。

## 快速开始

需要 [pnpm](https://pnpm.io/) 和一个高德 Web 服务 Key。

```bash
pnpm install

# 配置 Key
cp .env.example .env
#   在 .env 填入 M3D_AMAP_KEY（如账号需要，再填 M3D_AMAP_SECURITY_CODE）

pnpm dev          # 构建 watch + 本地服务（http://localhost:9001）
```

其它脚本：

```bash
pnpm build        # 打包到 dist/
pnpm serve        # 仅起静态服务（端口 9001）
```

> 也可以在 URL 上临时附加 `?key=YOUR_KEY` 来测试，无需重新构建。

## 实现说明

渲染管线、3D 列车几何，以及几个反复踩中的坑（高德节流、3D 透视下射向天空的乱线、平行四边形横截面、遮挡反向、内壁穿透）的成因与解法，记录在 [`progress.md`](progress.md)。

## License

MIT
