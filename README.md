# GeoLibre Project Demo

- 以GeoLibre为底座
- GEE的Map绘图（后期方便对接所有GEE js代码）
- 仿QGIS的界面
- 仿GeoLibre的插件加载系统

- `@geolibre/core` 的 Project/Layer/Group/Style
- `@geolibre/map/headless` 的图层同步

## 安装

```bash
cargo install --git https://github.com/kongdd/watershed --bin watershed_server
npm install
npm run dev
```

`watershed_server` 默认安装到 `~/.cargo/bin/`；运行前需设置 `SPATIALHYDRO_DATA` 指向流向、汇流累积量和拓扑索引所在目录。

### Pi Chat

右侧 Pi Chat 复用本机 `pi` 的模型授权、内置工具和已安装扩展，并将历史会话保存到 `~/.pi/agent/project-demo-chat/`。点击标题栏的“◉”并选择当前标签页后，每次提问都会附加最新界面截图，使 Pi 能看到用户正在操作的 UI；关闭面板或再次点击即停止共享。公网入口由 Caddy 鉴权，也可通过 `PI_CHAT_TOKEN` 增加二次访问控制。Markdown 禁止原始 HTML，模型与思考级别可在输入框下方切换。

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
