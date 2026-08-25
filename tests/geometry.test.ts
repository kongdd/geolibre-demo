import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionKind,
  emptyCollection,
  geometrySummary,
  lineFeature,
  modeStatus,
  dropFeature,
  nextGeometryColor,
  nextGeometryName,
  orientedRing,
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
  assert.equal(modeStatus("delete"), "Click a geometry to delete.");
});

test("dropFeature removes by index", () => {
  const collection = emptyCollection();
  collection.features.push(pointFeature([0, 0]), pointFeature([1, 1]));
  const next = dropFeature(collection, 0);
  assert.equal(next.features.length, 1);
  assert.deepEqual(next.features[0]?.geometry, pointFeature([1, 1]).geometry);
  assert.equal(dropFeature(collection, 9).features.length, 2);
});

test("line is a line layer, not points", () => {
  const line = lineFeature([
    [0, 0],
    [1, 1],
    [2, 0],
  ]);
  const collection = emptyCollection();
  if (line) collection.features.push(line);
  assert.equal(line?.geometry.type, "LineString");
  assert.equal(collectionKind(collection), "line");
  assert.equal(geometrySummary(collection), "(1 line)");
  assert.equal(geometrySummary(collection).includes("pt"), false);
});

test("orientedRing is perpendicular to the first edge", () => {
  const ring = orientedRing([0, 0], [2, 2], [0, 2]);
  assert.ok(ring);
  const edge: [number, number] = [ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]];
  const pull: [number, number] = [ring[3][0] - ring[0][0], ring[3][1] - ring[0][1]];
  assert.equal(edge[0] * pull[0] + edge[1] * pull[1], 0);
  assert.equal(collectionKind({ type: "FeatureCollection", features: [polygonFeature(ring.slice(0, 4))!] }), "poly");
});

test("rectangle is a polygon layer, not points", () => {
  const ring = rectangleRing([0, 0], [2, 2]);
  const rectangle = polygonFeature(ring.slice(0, 4));
  const collection = emptyCollection();
  if (rectangle) collection.features.push(rectangle);
  assert.equal(rectangle?.geometry.type, "Polygon");
  assert.equal(collectionKind(collection), "poly");
  assert.equal(geometrySummary(collection), "(1 poly)");
  assert.notEqual(geometrySummary(collection).includes("pt"), true);
});

test("summary keeps points and lines distinct", () => {
  const collection = emptyCollection();
  collection.features.push(pointFeature([0, 0]));
  const line = lineFeature([
    [0, 0],
    [1, 1],
  ]);
  if (line) collection.features.push(line);
  assert.equal(collectionKind(collection), "line");
  assert.equal(geometrySummary(collection), "(1 pt, 1 line)");
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
