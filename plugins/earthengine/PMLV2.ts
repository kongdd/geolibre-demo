type EeLike = {
  Image: new (arg?: unknown) => { date: () => { get: (key: string) => unknown } };
  Filter: { calendarRange: (start: unknown, end: unknown, field: string) => unknown };
};

export function filter_year(ee: EeLike, col: { sort: Function; filter: Function }, year?: number) {
  const y = year || new ee.Image(col.sort("system:time_start", false).first()).date().get("year");
  return col.filter(ee.Filter.calendarRange(y, y, "year"));
}

/** PML-V2 8-day：DN×0.08 → 年合计 mm a-1。 */
export function annualEt(
  ee: EeLike,
  col: { sort: Function; filter: Function; select: Function; map: Function },
  band = "ET",
  year?: number,
) {
  return filter_year(ee, col.select(band), year)
    .map((img: { multiply: (n: number) => unknown }) => img.multiply(0.08))
    .sum();
}
