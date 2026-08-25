import type { GeoLibreLayer } from "@geolibre/core";
import { layersOf } from "./earthengine";

const SAMPLE = {
  countries:
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
  rivers:
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_rivers_lake_centerlines.geojson",
  dem: "https://data.source.coop/giswqs/opengeos/dem.tif",
};

export async function buildSampleLayers(): Promise<{ layers: GeoLibreLayer[]; status: string }> {
  const [countries, rivers, dem] = await Promise.all([
    layersOf(SAMPLE.countries, { name: "国家边界", fill: "#8fbc8f22", stroke: "#3d5a45", width: 0.8 }),
    layersOf(SAMPLE.rivers, { name: "世界河流", stroke: "#1d4ed8", width: 1.6 }),
    layersOf(SAMPLE.dem, { name: "DEM", colormap: "terrain", opacity: 0.85, zoom: true }),
  ]);
  return {
    layers: [...countries, ...rivers, ...dem],
    status: `已加载国家 ${countries[0]?.geojson?.features.length ?? 0} / 河流 ${rivers[0]?.geojson?.features.length ?? 0} / DEM`,
  };
}
