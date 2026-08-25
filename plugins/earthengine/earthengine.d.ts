declare module "@google/earthengine" {
  const ee: {
    initialize: (...args: unknown[]) => void;
    data: { getAlgorithms: (callback?: (value: unknown, error?: unknown) => void) => unknown };
    [key: string]: unknown;
  };
  export default ee;
}
