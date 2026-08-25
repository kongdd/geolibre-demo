# GeoLibre Project Demo

- 以GeoLibre为底座
- GEE的Map绘图（后期方便对接所有GEE js代码）
- 仿QGIS的界面
- 仿GeoLibre的插件加载系统

- `@geolibre/core` 的 Project/Layer/Group/Style
- `@geolibre/map/headless` 的图层同步

```bash
npm install
npm run dev
```

- 支持 GeoJSON、zipped Shapefile、XYZ、远程 COG、本地 GeoTIFF、图层样式、Group、地图视图及 Project JSON 读写。
- 本地 GeoTIFF 保存到浏览器 IndexedDB；
- Project 文件在其他浏览器打开时需要重新提供对应资产。

控制台：

```js
// 本地
Map.addLayer(ee.FeatureCollection(fc), { color: "1d4ed8", width: 2 }, "河流")
Map.addLayer(ee.Image("https://.../dem.tif"), { palette: "terrain" }, "DEM")
// GEE（需 ee.Initialize）
Map.addLayer(ee.Image("USGS/SRTMGL1_003"), { min: 0, max: 3000 }, "SRTM")
```

![Project Demo](docs/deom.png)
