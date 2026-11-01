
export function projectSelectionId(project: { hostId: string; id: string }): string {
  return JSON.stringify([project.hostId, project.id]);
}
