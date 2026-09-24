export function createLatestSearch() {
  let generation = 0;
  return { start: () => ++generation, current: (request: number) => generation === request, invalidate: () => { generation += 1; } };
}
