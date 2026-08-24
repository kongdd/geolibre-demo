import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// MapLibre v6 ships its worker separately; Vite must emit and register it.
setWorkerUrl(maplibreWorkerUrl);
