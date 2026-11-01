const serviceAuthorityIds = new WeakMap<object, number>();
let nextServiceAuthorityId = 1;

export function getServiceAuthorityId(service: object): number {
  const existing = serviceAuthorityIds.get(service);
  if (existing !== undefined) return existing;
  const created = nextServiceAuthorityId++;
  serviceAuthorityIds.set(service, created);
  return created;
}
