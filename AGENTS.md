# AGENTS.md

最小 Project 示例：vanilla TS + Vite，复用 `@geolibre/core` 与 `@geolibre/map/headless`。仓库级约定见 `../../AGENTS.md`。

改 store，不直接改 MapLibre。

## 运行

```bash
npm install
npm test
npm run dev      # 127.0.0.1:5187  base=/project-demo/
```

线上：`https://ecohydro.top/project-demo/`。`vite.config.ts` 的 `base` / 端口不要改。

`@geolibre/core`、`@geolibre/map/headless` 经 alias 指向 `packages/` 源码；改包后刷新即可，不必先 build。

## 数据流

```
UI / 文件 → projectStore → createProjectRenderer
                              ├─ createLayerSync   矢量 / 底图
                              ├─ raster.sync       本地/远程栅格
                              └─ geometry editor   手绘几何
```

图层、样式、Group、视图只写 `projectStore`。`project-renderer` 订阅后同步。`noteLiveStyle` 仅给底图控件：控件已 `setStyle` 时跳过第二次 reload。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 组装 UI、文件入口、MapLibre 6 `transform` shim |
| `src/basemap.ts` | 底图控件与默认底图 |
| `src/samples.ts` | 空项目示例图层 |
| `src/project-store.ts` | Zustand store；Project 唯一真相 |
| `src/project-renderer.ts` | store → 地图 |
| `src/project-io.ts` | `.geolibre.json` 读写 |
| `src/layer-tree.ts` | 图层树 / 右键菜单 |
| `src/layer-order.ts` | 底图插入位、不透明底图遮挡 |
| `src/vector.ts` | GeoJSON / zip Shapefile |
| `src/raster.ts` | COG / 本地 GeoTIFF |
| `src/assets.ts` | 本地栅格 IndexedDB |
| `src/geometry.ts` / `geometry-editor.ts` | 手绘几何 |
| `src/style-editor.ts` | 图层样式 |
| `plugins/basemap-thumbnails.ts` | 底图缩略图；`./sync_geolibre.sh` 从主仓复制 |
| `plugins/earthengine/` | GEE（`@geolibre/plugins/earthengine`）：`ee.ts` / `Map.ts`，`plugin.ts` → `/api/ee/*` |

栅格（`project-raster`）与几何（`gee-geometry`）不走 `createLayerSync`。

## 约束

- 本地 GeoTIFF 只在当前浏览器 IndexedDB。Project JSON 换浏览器后须重新提供资产。
- MapLibre 6 已去掉 `map.transform`；`main.ts` 的 shim 必须保留，否则 `maplibre-gl-raster` 每帧报错、画面空白。发布版 `@geolibre/map` 尚未带此 shim。
- 不引入 React / 主应用 UI。需要的能力从 `@geolibre/core` 或本目录已有模块取。
- 不新增依赖；测试用 `node --import tsx --test`，只测纯函数。

## 测试

```bash
npm test
node --import tsx --test tests/<name>.test.ts
```

现有：`add`、`geometry`、`project-store`、`layer-order`、`raster`。改纯逻辑时补对应文件里的断言。
