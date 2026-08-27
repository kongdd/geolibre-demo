import ee, { type Image, type ImageCollection } from "@google/earthengine";

export function filter_year(col: ImageCollection, year?: number): ImageCollection {
  const y = year || ee.Image(col.sort("system:time_start", false).first()).date().get("year");
  return col.filter(ee.Filter.calendarRange(y, y, "year"));
}

/** PML-V2 8-day：DN×0.08 → 年合计 mm a-1。 */
export function annualEt(col: ImageCollection, band = "ET", year?: number): Image {
  return filter_year(col.select(band), year)
    .map((img) => img.multiply(0.08))
    .sum();
}
