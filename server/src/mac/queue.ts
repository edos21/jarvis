export type SerialQueue = <T>(work: () => Promise<T>) => Promise<T>;

// Runs work one at a time, in arrival order: an analysis and the cleanup that acts on it never overlap.
export const serialQueue = (): SerialQueue => {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
};
