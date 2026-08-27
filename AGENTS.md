# GeoLibre Project Demo

## 定位

这是一个 **vanilla TypeScript + Vite** 示例，不引入 React 或主应用 UI。

- 线上地址：`https://ecohydro.top/project-demo/`
- Vite `base`：`/project-demo/`
- 开发端口：`5187`
- 预览端口：`4187`

上述配置固定，不要修改。

## 架构

Project 是唯一真相，数据流保持单向：

```text
UI / 文件 / GEE / 插件
        ↓
projectStore
        ↓
project-renderer
        ↓
MapLibre / Raster / GEE / Geometry / Watershed
```

- UI 先更新 `src/project/store.ts`，再由 `src/project/renderer.ts` 同步地图。
- 不要在 UI 中维护第二套图层状态，也不要只调用 MapLibre 而不更新 store。
- COG、本地 GeoTIFF、GEE、几何和流域图层有独立同步路径；修改前先确认归属。
- MapLibre 直接调用仅限初始化、控件、交互和 renderer/plugin 集成边界。

## 关键约定

- Project 文件后缀固定为 `.geolibre.json`。
- Remote Project 位于 `public/projects/<key>.geolibre.json`，大数据放在
  `public/projects/<key>/data/`，Project 仅保存路径引用。
- Remote API 前缀为 `/project-demo/api/projects`；必须保留路径校验、同源写入、
  请求体限制、HTTP Range 和原子写入。
- 本地 GeoTIFF 仅存于浏览器 IndexedDB；导入导出不得静默丢失资产。
- GEE token、临时瓦片地址和其他运行态不得写入 Project。
- 流域结果使用 `Pours`、`Basins` 分组；出水点命名为 `Pour_$NAME`。
- COG/GeoTIFF 属于 `project-raster`；保持栅格位于最近上方矢量层之下。
- 保留 MapLibre 6 的 `map.transform` 兼容 shim 及其加载顺序。
- 不新增依赖；优先复用现有包和工具。
- 不编辑 `node_modules`；样式只改 `src/style.css`。
- 不覆盖或删除 `data/`、`public/data/`、`public/projects/` 中的用户数据。
- `vite.config.ts` 的 base、端口、alias、proxy 和 `minifyIdentifiers: false` 均有运行时用途。

## 运行与测试

默认使用发布版：

```bash
./start.sh
```

仅在调试或需要 HMR 时使用：

```bash
npm run dev
```

常用检查：

```bash
npm test
npm run build
npm run test:e2e
```

- 单元测试使用 `node:test` 与 `node:assert/strict`，不引入测试框架。
- 图层顺序、栅格、GEE、几何、流域、Remote API 或导入导出改动，必须补充对应测试。
- 涉及真实地图渲染或交互时，除单元测试外还需浏览器验证。
- 若本机路径依赖或浏览器环境不可用，明确说明未验证部分。

## 改动与交付

- 开始前检查 `git status --short`、调用方和现有测试。
- 只改任务相关文件；不做无关格式化，不删除有意义的注释。
- 行为、数据格式或运行方式改变时，同步更新测试和文档。
- 完成前运行 `git diff --check`，检查 diff 与工作区状态。
- Bug 修复总结必须包含：原因、修复内容、测试结果、交付文件。
