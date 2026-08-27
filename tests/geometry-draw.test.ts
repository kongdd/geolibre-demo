import assert from "node:assert/strict";
import test from "node:test";
import { clickDraw, emptyDraw, finishDraw, finishRect, previewDraw, setDrawMode } from "../plugins/geometry/geometry-draw";

const a: [number, number] = [0, 0];
const b: [number, number] = [2, 0];
const c: [number, number] = [2, 2];

test("line clicks stay draft until finish, then LineString", () => {
  let step = clickDraw(emptyDraw("line"), a);
  assert.equal(step.commit, null);
  step = clickDraw(step.state, b);
  assert.equal(step.commit, null);
  step = finishDraw(step.state);
  assert.equal(step.commit?.geometry.type, "LineString");
  assert.equal(step.commit?.properties?.kind, "line");
});

test("polygon clicks stay draft until finish, then Polygon", () => {
  let step = clickDraw(emptyDraw("polygon"), a);
  step = clickDraw(step.state, b);
  step = clickDraw(step.state, c);
  assert.equal(step.commit, null);
  step = finishDraw(step.state);
  assert.equal(step.commit?.geometry.type, "Polygon");
  assert.equal(step.commit?.properties?.kind, "polygon");
});

test("rectangle two clicks commit Polygon, not Point", () => {
  let step = clickDraw(emptyDraw("rectangle"), a);
  assert.equal(step.commit, null);
  step = clickDraw(step.state, c);
  assert.equal(step.commit?.geometry.type, "Polygon");
  assert.equal(step.commit?.properties?.kind, "polygon");
});

test("tilted rectangle: edge then perpendicular pull", () => {
  let step = clickDraw(emptyDraw("tilted"), a);
  assert.equal(step.commit, null);
  step = clickDraw(step.state, b);
  assert.equal(step.commit, null);
  assert.equal(previewDraw(step.state, [1, 1])?.geometry.type, "Polygon");
  step = clickDraw(step.state, [2, 2]);
  assert.equal(step.commit?.geometry.type, "Polygon");
  assert.equal(step.commit?.properties?.kind, "polygon");
  assert.equal(clickDraw(emptyDraw("tilted"), a).commit, null);
});

test("rectangle drag commits Polygon", () => {
  const started = clickDraw(emptyDraw("rectangle"), a).state;
  const step = finishRect(started, c);
  assert.equal(step.commit?.geometry.type, "Polygon");
});

test("point click is the only path that commits Point", () => {
  assert.equal(clickDraw(emptyDraw("point"), a).commit?.geometry.type, "Point");
  assert.equal(clickDraw(emptyDraw("line"), a).commit, null);
  assert.equal(finishDraw(clickDraw(emptyDraw("line"), a).state).commit, null);
  assert.equal(clickDraw(emptyDraw("polygon"), a).commit, null);
  assert.equal(clickDraw(emptyDraw("rectangle"), a).commit, null);
  assert.equal(finishRect(emptyDraw("rectangle"), c).commit, null);
});

test("same-corner rectangle does not commit", () => {
  const started = clickDraw(emptyDraw("rectangle"), a).state;
  assert.equal(finishRect(started, a).commit, null);
  assert.equal(clickDraw(started, a).commit, null);
});

test("preview is never a Point", () => {
  const line = clickDraw(emptyDraw("line"), a).state;
  assert.notEqual(previewDraw(line, b)?.geometry.type, "Point");
  const rect = clickDraw(emptyDraw("rectangle"), a).state;
  assert.equal(previewDraw(rect, c)?.geometry.type, "Polygon");
});

test("changing tool clears draft", () => {
  const drawing = clickDraw(emptyDraw("line"), a).state;
  assert.equal(drawing.draft.length, 1);
  assert.deepEqual(setDrawMode("polygon"), emptyDraw("polygon"));
});
