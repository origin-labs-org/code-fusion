import type { ComponentProps } from "react";
import { ProjectEditor } from "@/project-sidebar/ProjectEditor.js";
import { RemoteProjectList } from "@/project-sidebar/RemoteProjectList.js";

export function RemoteProjectPicker(
  props: Omit<ComponentProps<typeof RemoteProjectList>, "renderCreate">,
) {
  return (
    <RemoteProjectList
      {...props}
      renderCreate={(projects, add, close) => (
        <ProjectEditor
          host={props.host}
          initialRoots={props.initialRoots}
          project={null}
          projects={projects}
          service={props.service}
          onClose={close}
          onSaved={add}
        />
      )}
    />
  );
}
