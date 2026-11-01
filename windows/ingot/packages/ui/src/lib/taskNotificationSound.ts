import taskNotificationPopUrl from "@/assets/notification-sounds/task-notification-pop.mp3";
import { isTaskNotificationSoundEnabled } from "@/lib/taskNotificationPreferences.js";

let taskNotificationAudio: HTMLAudioElement | null = null;

function getTaskNotificationAudio(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") {
    return null;
  }

  if (!taskNotificationAudio) {
    taskNotificationAudio = new Audio(taskNotificationPopUrl);
    taskNotificationAudio.preload = "auto";
  }

  return taskNotificationAudio;
}

export async function playTaskNotificationSound(): Promise<void> {
  if (!isTaskNotificationSoundEnabled()) {
    return;
  }

  const audio = getTaskNotificationAudio();
  if (!audio) {
    return;
  }

  try {
    audio.pause();
    audio.currentTime = 0;
    await audio.play();
  } catch {
  }
}
