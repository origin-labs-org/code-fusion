
export const DOCUMENT_HIDDEN_ATTRIBUTE = "data-document-hidden";

export function installDocumentHiddenMotionPause(doc: Document = document): () => void {
  const sync = () => {
    doc.documentElement.toggleAttribute(
      DOCUMENT_HIDDEN_ATTRIBUTE,
      doc.visibilityState === "hidden",
    );
  };
  sync();
  doc.addEventListener("visibilitychange", sync);
  return () => {
    doc.removeEventListener("visibilitychange", sync);
    doc.documentElement.removeAttribute(DOCUMENT_HIDDEN_ATTRIBUTE);
  };
}
