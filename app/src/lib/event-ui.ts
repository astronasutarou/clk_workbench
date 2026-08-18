export function shouldActivateEventTrack(
  key: string,
  isEventTrackTarget: boolean,
) {
  return isEventTrackTarget && (key === "Enter" || key === " ");
}
