#!/usr/bin/env bash
# Virtual audio devices for the capture harness on Linux (PulseAudio or PipeWire's pulse server):
#   meeting_out  default speaker: the fake meeting plays remote voices here, and the app
#                captures it through Chromium's loopback, exactly like real meeting audio.
#   virtual_mic  default microphone, fed by the "mic_feed" output: the fake meeting plays
#                the user's voice into it, and the app captures it with getUserMedia.
set -euo pipefail
if ! pactl info >/dev/null 2>&1; then
  if [ "$(id -u)" = 0 ]; then
    pulseaudio -D --exit-idle-time=-1 --disallow-exit 2>/dev/null
  else
    pulseaudio -D --exit-idle-time=-1
  fi
  for _ in $(seq 1 20); do pactl info >/dev/null 2>&1 && break; sleep 0.25; done
fi
pactl list short sinks | grep -q meeting_out ||
  pactl load-module module-null-sink sink_name=meeting_out sink_properties=device.description=Meeting_speakers >/dev/null
pactl list short sinks | grep -q mic_feed ||
  pactl load-module module-null-sink sink_name=mic_feed sink_properties=device.description=Mic_feed >/dev/null
# A built-in "laptop microphone" (silent), so unplugging the virtual headset microphone
# falls back to it, the way a real laptop does.
pactl list short sinks | grep -q laptop_feed ||
  pactl load-module module-null-sink sink_name=laptop_feed sink_properties=device.description=Laptop_feed >/dev/null
pactl list short sources | grep -q laptop_mic ||
  pactl load-module module-remap-source master=laptop_feed.monitor source_name=laptop_mic source_properties=device.description=Laptop_microphone >/dev/null
pactl list short sources | grep -q virtual_mic ||
  pactl load-module module-remap-source master=mic_feed.monitor source_name=virtual_mic source_properties=device.description=Virtual_microphone >/dev/null
# Start every run at full volume: a program with automatic gain control can lower a
# monitor's volume, and PulseAudio remembers it between runs.
for src in meeting_out.monitor mic_feed.monitor virtual_mic laptop_mic; do pactl set-source-volume "$src" 100%; done
pactl set-sink-volume meeting_out 100%
pactl set-sink-volume mic_feed 100%
pactl set-default-sink meeting_out
pactl set-default-source virtual_mic
echo "PulseAudio ready: speaker=meeting_out microphone=virtual_mic (fed by mic_feed)"
