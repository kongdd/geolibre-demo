import type { GeoLibreLayer } from "@geolibre/core";
import { ee } from "@geolibre/plugins/earthengine";
import { projectStore } from "./project-store";

const SAMPLE = {
  countries:
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
  rivers:
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_rivers_lake_centerlines.geojson",
  dem: "https://data.source.coop/giswqs/opengeos/dem.tif",
};

function addGroup(name: string, layers: GeoLibreLayer[]): GeoLibreLayer[] {
  const store = projectStore.getState();
  store.moveLayerToGroup(store.addGroup(name), layers.map((layer) => layer.id));
  return layers;
}

export async function loadDemoLayers(): Promise<string> {
  await Map.addBasemap(["google-satellite", "osm-standard"]);

  const layers = addGroup("Natural Earth", [
    Map.addLayer(SAMPLE.countries, { fill: "#8fbc8f22", stroke: "#3d5a45", width: 0.8 }, "国家边界"),
    Map.addLayer(SAMPLE.rivers, { stroke: "#1d4ed8", width: 1.6 }, "世界河流"),
    Map.addLayer(SAMPLE.dem, { colormap: "terrain", opacity: 0.85 }, "DEM"),
  ]);

  await ee.Initialize();
  const layers_gee = addGroup("GEE", [
    Map.addLayer(
      ee.Image("USGS/SRTMGL1_003"),
      { min: 0, max: 4000, palette: ["006633", "E5FFCC", "662A00", "D8D8D8", "F5F5F5"] },
      "SRTM",
    ),
    Map.addLayer(
      ee.ImageCollection("projects/pml_evapotranspiration/PML/OUTPUT/PML_V22a_VIIRS"),
      {
        min: 0,
        max: 1600,
        bands: ["ET"],
        composite: "yearSum",
        scale: 500,
        palette: [
          "0000FF", "033FA9", "067F54", "18B80E", "70D209", "C7EE03", "FFF200",
          "FFD200", "FFB100", "FF8000", "FF4500", "FF0A00", "CE0027", "920057", "570088",
        ],
      },
      "PML-V2 ET",
    ),
  ]);
  layers.push(...layers_gee);

  return `已加载 ${layers.map((layer) => layer.name).join(" / ")}`;
}
