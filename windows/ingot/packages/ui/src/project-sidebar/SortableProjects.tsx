import type { ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { VirtualProject } from "@/project-sidebar/contract.js";
import { projectKey } from "@/project-sidebar/view.js";

const pointerOptions = { activationConstraint: { distance: 6 } };
const keyboardOptions = { coordinateGetter: sortableKeyboardCoordinates };

export function SortableProjects({
  projects,
  renderProject,
  onReorder,
}: {
  projects: VirtualProject[];
  renderProject(project: VirtualProject): ReactNode;
  onReorder(active: string, over: string): void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, pointerOptions),
    useSensor(KeyboardSensor, keyboardOptions),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
      }}
    >
      <SortableContext items={projects.map(projectKey)} strategy={verticalListSortingStrategy}>
        {projects.map(renderProject)}
      </SortableContext>
    </DndContext>
  );
}
