declare module "@google/earthengine" {
  export interface ComputedObject {
    serialize(legacy?: boolean): string;
  }

  export interface Image extends ComputedObject {
    date(): { get(key: string): unknown };
    multiply(value: number): Image;
  }

  export interface ImageCollection extends ComputedObject {
    sort(property: string, ascending?: boolean): ImageCollection;
    first(): Image;
    filter(filter: unknown): ImageCollection;
    select(band: string): ImageCollection;
    map(fn: (image: Image) => Image): ImageCollection;
    sum(): Image;
  }

  const ee: {
    initialize: (...args: unknown[]) => void;
    data: { getAlgorithms: (callback?: (value: unknown, error?: unknown) => void) => unknown };
    Image(arg?: unknown): Image;
    ImageCollection(arg?: unknown): ImageCollection;
    Filter: { calendarRange(start: unknown, end: unknown, field: string): unknown };
    [key: string]: unknown;
  };
  export default ee;
}
