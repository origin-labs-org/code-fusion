export const loadWorkEnvironmentWorkspace = () =>
  import("./components/WorkEnvironmentWorkspace.svelte");
/** The composer's model chip and dictation, for the sidebar assistant's composer. */
export const loadModelPicker = () => import("./components/bar/ModelPicker.svelte");
export const loadVoice = () => import("./components/bar/VoiceView.svelte");
