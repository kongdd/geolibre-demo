import ee from "ee-auth";

export function filter_year(col: ee.ImageCollection, year?: number): ee.ImageCollection {
  const y = year || ee.Image(col.sort("system:time_start", false).first()).date().get("year");
  return col.filter(ee.Filter.calendarRange(y, y, "year"));
}

/** PML-V2 8-day：DN×0.08 → 年合计 mm a-1。 */
function ETYearSum(col: ee.ImageCollection): ee.Image {
  return col.map((img: ee.Image) => img.multiply(0.08)).sum();
}

export function annualEt(col: ee.ImageCollection, band = "ET", year?: number): ee.Image {
  return ETYearSum(filter_year(col.select(band), year));
}
