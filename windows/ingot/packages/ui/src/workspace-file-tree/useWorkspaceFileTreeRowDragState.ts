import { useEffect, useState } from "react";

export function useWorkspaceFileTreeRowDragState() {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const resetDragging = () => setIsDragging(false);
    window.addEventListener("dragend", resetDragging);
    window.addEventListener("drop", resetDragging);
    window.addEventListener("blur", resetDragging);
    return () => {
      window.removeEventListener("dragend", resetDragging);
      window.removeEventListener("drop", resetDragging);
      window.removeEventListener("blur", resetDragging);
    };
  }, [isDragging]);

  return { isDragging, setIsDragging };
}
