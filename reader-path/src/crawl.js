// One folder name per route shape: ids collapse, so one page stands for
// every page of that shape.
const ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

export function shape(pathname) {
  const parts = pathname.split('/').filter(Boolean).map((p) => (ID.test(p) ? 'id' : p));
  return parts.length ? parts.join('_') : 'root';
}
