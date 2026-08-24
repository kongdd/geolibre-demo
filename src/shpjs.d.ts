declare module "shpjs" {
  import type { FeatureCollection } from "geojson";

  interface NamedFeatureCollection extends FeatureCollection {
    fileName?: string;
  }

  export default function shp(
    data: ArrayBuffer,
  ): Promise<NamedFeatureCollection | NamedFeatureCollection[]>;
}
