# GeoLibre Project Demo

最小 Project 示例：复用 `@geolibre/core` 的 Project/Layer/Group/Style 与 `@geolibre/map/headless` 的图层同步。

```bash
npm install
npm run dev
```

支持 GeoJSON、zipped Shapefile、XYZ、远程 COG、本地 GeoTIFF、图层样式、Group、地图视图及 Project JSON 读写。本地 GeoTIFF 保存到浏览器 IndexedDB；Project 文件在其他浏览器打开时需要重新提供对应资产。

![Project Demo](docs/deom.png)
