import { createContext } from "react";

export const ComposerSubmissionPendingContext = createContext<((pending: boolean) => void) | null>(
  null,
);
