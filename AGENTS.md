# GeoLibre Project Demo 开发指南

本文件只约束 `examples/project-demo/`。仓库根目录的 `AGENTS.md` 和
`CLAUDE.md` 仍然适用；本文件对本示例的约束更具体。

## 项目定位

这是一个 **vanilla TypeScript + Vite** 示例，不是 React 应用。它用少量代码
演示 GeoLibre 的项目模型、图层同步、GEE JavaScript 风格 API 和仿 QGIS 的
图层面板；不要把主应用的 React 组件或完整插件体系搬进来。

运行地址固定为：

- 开发：`http://127.0.0.1:5187/project-demo/`
- 线上：`https://ecohydro.top/project-demo/`
- Vite `base` 固定为 `/project-demo/`，开发端口固定为 `5187`，不要修改。

## 数据流与边界

```text
UI / 文件 / GEE / 插件
        ↓
projectStore（项目唯一真相）
        ↓
project-renderer
  ├─ createLayerSync：GeoJSON、底图等标准图层
  ├─ raster.sync：COG / 本地 GeoTIFF
  ├─ syncGeeRaster：GEE XYZ 栅格
  └─ geometry / watershed：自有控件与结果图层
```

- 图层、样式、分组、可见性、相机和项目持久化状态先写
  `src/project-store.ts`，再由同步器渲染。
- 不要在 UI 事件中直接维护一套独立的图层状态，也不要只调用 MapLibre API
  而不更新 store。
- `src/project-renderer.ts` 是 store 到地图的桥；`maplibre-gl-raster`、GEE、
  几何编辑器和流域插件不完全走 `createLayerSync`，修改前先确认所属同步路径。
- 直接使用 MapLibre 仅限地图初始化、控件、交互和 renderer/plugin 的集成边界；
  不要把 MapLibre 细节扩散到普通 UI 逻辑。
- `@geolibre/core` 与 `@geolibre/map/headless` 通过 `vite.config.ts` alias
  指向仓库源码；修改这些包后开发服务器会直接读取源码，不需先构建 npm 包。

## 文件职责

| 路径 | 职责 |
| --- | --- |
| `index.html` | 页面骨架、工具栏、图层面板、文件输入和状态栏 |
| `src/main.ts` | 启动 MapLibre、注册控件、组装 UI/插件、处理文件入口 |
| `src/project-store.ts` | Zustand vanilla store；Project 唯一真相 |
| `src/project-renderer.ts` | Project → MapLibre/栅格/GEE/几何的同步 |
| `src/project-io.ts` | Project 解析、远程保存/打开、独立 GeoJSON 数据上传、导入导出 |
| `src/project-filename.ts` | Project 名称、文件名和旧 UUID 文件迁移规则 |
| `src/layer-tree.ts` | 图层树、分组、拖拽排序和右键操作 |
| `src/layer-order.ts` | 底图插入、组内顺序、遮挡和 UI/地图顺序转换 |
| `src/raster.ts` | `RasterControl` 适配、本地资产、COG 状态和栅格锚点顺序 |
| `src/assets.ts` | 浏览器 IndexedDB 中的本地栅格资产 |
| `src/vector.ts` | GeoJSON、GeoJSON URL、zip Shapefile 的读取与图层创建 |
| `src/style-editor.ts` | 图层样式编辑器 |
| `src/identify.ts` | GeoJSON/GEE 栅格识别 |
| `src/legend.ts` | 图例与颜色解析 |
| `src/samples.ts` | 湖北水文、Natural Earth、GEE 和底图示例数据 |
| `plugins/earthengine/` | GEE `ee`、`Map.addLayer`、GEE route 和运行时瓦片同步 |
| `plugins/geometry/` | 点、线、面、矩形绘制与编辑 |
| `plugins/watershed/` | 流域提取、出水点选择、FlowDir/FlowAccum 选择和结果分组 |
| `plugins/projects/` | Vite 开发/预览服务器上的 Remote Project API |
| `plugins/basemap-thumbnails.ts` | 底图缩略图；由 `sync_geolibre.sh` 同步相关代码 |
| `data/` | 示例原始数据；不与 `public/data/` 的发布资源混用 |
| `public/data/` | Vite 可访问的静态数据 |
| `public/projects/` | Remote Project JSON 与独立数据目录 |
| `tests/` | Node 内置测试；`tests/e2e/` 是独立 Playwright/浏览器脚本 |
| `images/` | 截图和验证图；文档使用相对路径引用 |

## Project 与 Remote API

- Project 后缀固定为 `.geolibre.json`。
- Remote Project 存储在 `public/projects/<key>.geolibre.json`；GeoJSON 等大数据
  放在 `public/projects/<key>/data/`，Project 只保存路径引用。
- `plugins/projects/plugin.ts` 同时挂载到 Vite dev 和 preview server，API 前缀为
  `/project-demo/api/projects`；支持列出、读取、PUT 保存、DELETE 删除，以及
  带 HTTP Range 的数据文件读取。
- API 必须保持项目 key、资产名校验、same-origin 写入限制、请求体大小限制和
  原子写入；不要为了方便改成任意路径读写。
- 本地导入/导出当前是 Project JSON；Remote 保存和本地导出是不同路径，不要
  混淆“保存到 Remote”和“导出到本地”。
- 本地 GeoTIFF 只暂存于当前浏览器 IndexedDB；Project JSON 本身不携带该资产。
  修改导入导出时必须明确处理资产缺失，不能静默丢失。
- GEE 的待定 token/瓦片运行态不得写入 Project；`sanitizeGeeProject` 和
  `PENDING_EE_TILES` 相关逻辑必须保持脱敏。

## 插件与图层约定

- GEE 使用 `plugins/earthengine/Map.ts` 的 `Map.addLayer`、`Map.addGroup` 等
  入口；不要覆盖原生 `Map` 构造器，只扩展 `globalThis.Map` 的示例 API。
- GEE 图层需要 `ee.Initialize()` 后才能请求；网络失败应显示可读状态，不能让
  页面初始化崩溃。
- 几何图层使用 `gee-geometry` 相关 metadata/同步逻辑；绘制过程中的 draft
  不应被当成已提交结果。
- 流域结果固定使用 `Pours`、`Basins` 分组；出水点命名为 `Pour_$NAME`，流域
  命名为 `$NAME`。结果先留在 Project 中，用户明确保存/导出时才下载。
- COG/GeoTIFF 属于 `project-raster`，不交给普通 `createLayerSync`。栅格有
  独立的绘制顺序；其 `beforeId` 必须保持在上方最近矢量层之前，避免栅格盖住
  市界等线面图层。
- `MapLibre 6` 已移除 `map.transform`；`@geolibre/map/headless` 提供的兼容
  shim 以及 `src/main.ts` 的加载顺序必须保留，否则 raster/deck.gl 可能空白。
- 分组顺序是 Project/UI 与 MapLibre 绘制顺序之间的转换点。改排序前同时检查
  `src/layer-order.ts`、`src/project-store.ts`、`src/project-renderer.ts` 和
  raster adapter，不要只修面板显示。

## 依赖与配置

- 不新增依赖；优先复用现有 `@geolibre/core`、`@geolibre/map/headless`、
  `maplibre-gl-raster`、`shpjs` 和已有工具。
- `vite.config.ts` 中的 `base`、`server.port`、`preview.port`、alias、
  `minifyIdentifiers: false` 都有运行时原因；GEE 依赖形参名解析，不能随意开启
  identifier 压缩。
- 不引入 React、主应用 UI 或主应用的状态管理。
- 不编辑 `node_modules`；控件样式只改 `src/style.css`，底图缩略图同步使用既有
  脚本/patch。
- `@spatialhydro/watershed`、`ee-auth` 是本机路径依赖。若依赖路径不可用，先
  说明环境限制，不要偷偷改成未经确认的远程包。
- `data/`、`public/data/` 和 `public/projects/` 中已有用户数据可能很大；改代码
  时不要重生成、压缩、覆盖或删除它们。

## 开发与测试

首次安装和常用命令：

```bash
npm install
npm run dev                       # 127.0.0.1:5187/project-demo/
npm run build                     # tsc --noEmit + Vite production build
npm test                          # tests/*.test.ts
npm run test:e2e                  # geometry + watershed 浏览器流程
npm run preview                   # Vite preview，端口 4187

git diff --check
```

定向测试：

```bash
node --import tsx --test tests/<name>.test.ts
xvfb-run -a node --import tsx tests/e2e/<name>-e2e.ts
```

- 单元测试只测纯函数、store、项目存储、API 路由、图层顺序和解析逻辑；使用
  `node:test` + `node:assert/strict`，不要引入测试框架。
- 浏览器测试使用项目外层可用的 Playwright，并强制 WebGL/SwiftShader；涉及地图、
  控件、异步 COG/GEE 或真实图层顺序的改动不能只靠 `tsc`。
- `npm run test:e2e` 当前执行 `tests/e2e/geometry-e2e.ts` 和
  `tests/e2e/watershed-e2e.ts`；`palette-e2e.ts` 需定向执行。
- 改图层顺序、选点交互、栅格渲染、GEE 运行、Remote API 或项目导入导出时，至少
  同时补充对应纯函数断言和一次浏览器验证。
- 不要声称“已修复”而不提供实际测试结果；若无法运行浏览器或本机路径依赖，须
  明确写出未验证部分。

## 改动与交付

- 先看 `git status --short`、调用方和现有测试；只改本任务相关文件。
- 保留有意义的注释和用户数据；不要整文件格式化造成无关 diff。
- 功能改动必须同步更新测试；行为、数据格式或运行方式改变时同步更新 README
  和本文件。
- 完成前检查 `git diff`、`git diff --check`、`git status --short`，确认没有临时
  文件、密钥、构建产物或误改 `public/data/`。
- 最终总结保持简短但必须说明：**Bug 原因、修复内容、测试结果、交付文件**。
