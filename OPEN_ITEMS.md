
---

## VOICE — background music during mic (CLOSED 2026-09-19, won't fix)

Closes the S-series note "mic input fails on a real iPhone 13". Root cause of that
one was a revoked microphone permission, not code. Repo: EndopaminMobile, baseline
eb5527f.

Investigated on device with full AVAudioSession instrumentation. Behavior that ships,
and is correct:
- music stops while the mic is recording
- music ducks correctly during coach TTS
- music returns to full volume when the voice session ends

Any recording path on iOS forces playAndRecord, and other apps' audio is interrupted
regardless of mixWithOthers. True for expo-av Audio.Recording AND for
expo-speech-recognition used alone. 161 polled session snapshots showed the category
never deviated from playAndRecord + mixWithOthers + duckOthers + allowBluetooth +
defaultToSpeaker. Reproduced identically with Apple Music, so not Spotify-specific.

Four separate patch attempts each regressed the working TTS duck and were reverted.
Do not reopen without new platform-level evidence.

Fixed the same session: first mic tap was consumed by a mount-time session teardown
race; music now restores reliably via notifyOthersOnDeactivation on every exit path.

Still open, same area: barge-in / interrupt is not implemented. Proposed approach is
tap-to-interrupt (the mic button becomes stop while the coach speaks), not true
barge-in, which would require holding an exclusive session open and echo cancellation.
