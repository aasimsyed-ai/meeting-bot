/** Label for a speaker key: "You" for the microphone, "Speaker N" for voices in meeting audio. */
export function labelFor(key: string, labels: Map<string, string>): string {
  let label = labels.get(key);
  if (!label) {
    label =
      key === 'mic' ? 'You' : `Speaker ${[...labels.keys()].filter((k) => k !== 'mic').length + 1}`;
    labels.set(key, label);
  }
  return label;
}
