# GeoLibre Project Demo

- 以GeoLibre为底座
- GEE的Map绘图（后期方便对接所有GEE js代码）
- 仿QGIS的界面
- 仿GeoLibre的插件加载系统

- `@geolibre/core` 的 Project/Layer/Group/Style
- `@geolibre/map/headless` 的图层同步

## 安装

```bash
npm install
./start.sh
```

`start.sh` 构建前端并以 systemd user service 启动 SpatialHydro Rust API（`:8765`）和 Julia 模型服务（`:9090`），随后重启 `/project-demo/` 的发布版。默认使用 `/mnt/z/GitHub/kongdd/SpatialHydro`；可通过 `SPATIALHYDRO_ROOT`、`SPATIALHYDRO_DATA`、`SPATIALHYDRO_PORT` 和 `JULIA_MODEL_PORT` 覆盖。首次启动前需在 SpatialHydro 的 `crates/SpatialHydro` 中构建 release backend。

仅调试前端 HMR 时使用 `npm run dev`。

### FLASHFLOOD 山洪预报插件

工具栏闪电图标打开 `FlashFlood` 工作台；工作台以本项目的 **geolibre-lite / MapLibre** 为底图和 Project 图层容器，对接 SpatialHydro（默认 `http://127.0.0.1:8765`）：

1. 数据舱：加载十堰监测流域、站点强迫元数据和模型参数，也可用 CSV 临时覆盖 `P`、`PET_Romanenko`、`Q`、`R`；
2. 场次划分：按 HydroFloods 阈值、间隔、历时与延展规则识别训练/验证场次；
3. 参数率定：异步运行 SCE-UA，显示任务进度、最优目标值并支持取消；
4. 敏感性分析：运行单参数扰动，绘制 KGE 响应曲线与参数排序；
5. 历史模拟：使用服务端率定参数或模型默认值回放历史洪水；
6. 未来预报：衔接历史暖机窗和未来强迫窗，显示预报过程、洪峰和峰现时间。

![FLASHFLOOD 山洪预报工作台](images/flash-flood-live.png)

启动 SpatialHydro 的 Rust API 与 Julia 模型服务后运行本项目。可用 `SPATIALHYDRO_API_URL` 修改代理目标；Project API 和 Pi Agent API 不会被该代理截获。

本地 CSV 表头示例：

```csv
time,P,PET_Romanenko,Q,R
2024-07-01T00:00:00,0.0,0.2,3.4,0.8
```

### Pi Web

右侧 Pi Web 面板嵌入本机运行的 `pi-web`（`:30141`），复用其完整会话、模型、技能和文件工作区。公网使用同域根路径；Vite 开发时直连本机服务。

- Project 默认保存为 `public/projects/<ProjectName>.geolibre.json`；旧 UUID 文件在下次保存时自动迁移，同名新 Project 须先改名。
- Project 仅保存配置与数据路径；本地数据独立写入 `public/projects/<project-key>/data/`。
- 支持远程打开、保存、删除；导入、导出使用本地 Project JSON。
- 本地 GeoTIFF 在首次 Remote 保存前暂存于浏览器 IndexedDB。

控制台：

```js
// 本地
Map.addLayer(ee.FeatureCollection(fc), { color: "1d4ed8", width: 2 }, "河流")
Map.addLayer(ee.Image("https://.../dem.tif"), { palette: "terrain" }, "DEM")
// GEE（需 ee.Initialize）
Map.addLayer(ee.Image("USGS/SRTMGL1_003"), { min: 0, max: 3000 }, "SRTM")
```

![Project Demo](docs/deom.png)
