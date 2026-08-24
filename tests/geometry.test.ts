import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyCollection,
  lineFeature,
  modeStatus,
  nextGeometryColor,
  nextGeometryName,
  pointFeature,
  polygonFeature,
  rectangleRing,
  vertexCount,
} from "../src/geometry";

test("vertexCount counts points and open rings", () => {
  const collection = emptyCollection();
  collection.features.push(pointFeature([0, 0]), pointFeature([1, 1]));
  const line = lineFeature([
    [0, 0],
    [1, 0],
    [1, 1],
  ]);
  if (line) collection.features.push(line);
  const polygon = polygonFeature([
    [0, 0],
    [1, 0],
    [1, 1],
  ]);
  if (polygon) collection.features.push(polygon);
  assert.equal(vertexCount(collection), 8);
});

test("rectangleRing is a closed box", () => {
  assert.deepEqual(rectangleRing([1, 2], [3, 5]), [
    [1, 2],
    [3, 2],
    [3, 5],
    [1, 5],
    [1, 2],
  ]);
});

test("modeStatus matches GEE copy", () => {
  assert.equal(modeStatus("point"), "Point drawing.");
  assert.equal(modeStatus("pan"), "");
});

test("line and polygon are not points", () => {
  const line = lineFeature([
    [0, 0],
    [1, 1],
  ]);
  const polygon = polygonFeature([
    [0, 0],
    [1, 0],
    [1, 1],
  ]);
  assert.equal(line?.geometry.type, "LineString");
  assert.equal(polygon?.geometry.type, "Polygon");
});

test("next geometry name and color", () => {
  assert.equal(nextGeometryName([]), "geometry");
  assert.equal(nextGeometryName(["geometry"]), "geometry 2");
  assert.equal(nextGeometryColor(["#c62828"]), "#1565c0");
});
