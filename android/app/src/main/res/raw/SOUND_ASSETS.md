# Sound Assets — android/app/src/main/res/raw/

Place WAV sound files here before building a release APK/AAB.
The files are gitignored as binary assets; copy them from the design
assets repository or generate them before each native build.

| Filename              | Purpose                          | Urgency |
|-----------------------|----------------------------------|---------|
| `glev_pre_check.wav`  | Pre-bolus meal-timeline reminder | Low     |
| `glev_post_check.wav` | Post-bolus meal-timeline check   | Low     |
| `glev_low_alarm.wav`  | Low-glucose alarm (Task #677)    | **High**|

## glev_low_alarm.wav requirements

- **Duration**: 3–5 seconds (loops on Android while notification is visible)
- **Format**: WAV, 44.1 kHz, 16-bit mono
- **Tone**: Urgent, distinct from the meal-check sounds — e.g. a repeating
  double-beep at a higher frequency (880 Hz + 1046 Hz alternating)
- **Volume**: Peaks at –3 dBFS (will be further controlled by OS alarm volume)

## iOS

For iOS, add `glev_low_alarm.wav` to the Xcode project under
`ios/App/App/` and make sure the file is added to the
"Copy Bundle Resources" build phase. The Capacitor
`@capacitor/local-notifications` plugin picks it up automatically
by filename when the `sound` field of a scheduled notification is
set to `"glev_low_alarm.wav"`.
