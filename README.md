# Phactory Signal

A private light-and-sound communication instrument for iPhone. Capture bright lights, inspect pulse timing and audio frequencies, then compose a response using the screen and speakers.

Designed by **Tech Phactory Solutions**.

## Run on your iPhone

1. Put the contents of this folder in a GitHub repository. `index.html` must be at the repository root, alongside `app.js`, `engine.js`, `styles.css`, `sw.js`, the manifest, and the `icons` folder.
2. In **Settings → Pages**, choose **Deploy from a branch → main → / (root) → Save**. Wait for GitHub's deployment to finish.
3. Open the HTTPS address shown by GitHub Pages in **Safari**. Opening the source file in Files or a GitHub code preview does not run the app correctly.
4. Tap **Share → Add to Home Screen**. Open the app once online so its files can be cached for offline use.
5. Tap **Explore test signal** to try the full detection pipeline. For your own media, tap **Use camera** or **Import media**.

No build, API key, subscription, server, or package installation is needed to run the app. The optional `package.json` is for developer tests. The repository's automated check runs the signal-engine tests on pushes and pull requests.

## What is implemented

- **Rear camera:** user-initiated live capture. Optional microphone input is requested only when its checkbox is enabled before opening the camera.
- **Video import:** local video playback with brightness detection and FFT analysis of the accompanying soundtrack. Use Play, Pause, Restart, or seek. Seeking starts a fresh trace. Safari must support the selected file's codecs; H.264 video with AAC audio in MP4 is a good exchange format.
- **Photo import:** measured color and selected-region inspection. A photo has no pulse durations, sequence, or accompanying audio.
- **Light tracking:** brightness thresholding, connected bright regions, nearest-region tracking, and a manually selectable region. Tap the viewfinder to isolate the intended light; reset the target to use the full frame.
- **Pulse log:** onset, duration, sampled RGB, clipping fraction, number of samples, frame timing estimate, prominent audio note, and mapped color note. Up to 3,000 pulses per trace; the table shows the most recent 150 and exports include the full retained trace.
- **Analysis displays:** measured light-intensity history, pulse timeline, audio FFT spectrum, frequency in Hz, chromatic note, and solfège for natural notes in the C-major convention.
- **References:** a D4–E4–C4–C3–G3 five-tone cinematic greeting, SOS, HELLO in International Morse, and prime-number pulse groups 2–3–5–7. Matching also supports custom dictionaries.
- **Response deck:** seven colored note pads, a 32-step sequencer, chromatic note selection C2–B6, arbitrary RGB output colors, individual on/gap durations, reorder/remove controls, synth volume, sine/triangle sound, and up to three repeats from the UI.
- **Transmission:** a full-window color display with scheduled oscillator tones, optional soft light transitions, and an always available Stop button. Browser fullscreen and a wake lock are requested when supported. The app remains usable without either capability.
- **Persistence:** up to 25 recent sessions and 30 custom dictionary entries in the current browser's local storage. JSON/CSV session export and JSON dictionary import/export are included. Media files are not stored or uploaded.
- **Offline app shell:** a relative-path manifest, iPhone Home Screen icon, and service worker work under a GitHub Pages project subdirectory.

## Quick field workflow

1. Start the camera, or import a clip and press Play.
2. Tap near the light you want to examine. Lower the threshold if it is too dim, or raise it if background regions are being detected.
3. Let an entire sequence finish. The detector closes a pulse after its light disappears; its recorded ending uses the first missing frame rather than the end of the debounce period.
4. Stop, review the log, and save or export the session.
5. Use **Use as response** to copy measured pulses to the deck, or choose a preset and edit it. Output on/off intervals are each at least 250 ms, so very short captured pulses will be lengthened.
6. For a shared custom meaning, save the response to your dictionary and export that dictionary to the receiver. Both sides need the same agreed convention.
7. Raise iPhone brightness manually in Control Center before broadcasting. Keep the app visible. Switching apps or locking the phone stops capture and sound.

## How to interpret the results

This is a measurement and pattern-matching tool. It does not identify the object producing a light or establish that an unknown pattern is language, intentional communication, or evidence of a particular source.

**RGB is not an optical spectrum.** Values come from a downscaled decoded image (longest side up to 320 pixels). Camera exposure, white balance, saturation/clipping, compression, and blended boundary pixels affect the result. The display produces RGB colors, not a selected monochromatic wavelength. Brightness cannot be set programmatically in an iPhone web app.

**Durations are estimates.** Onset and ending are quantized by analyzed frames. Video processing follows `requestVideoFrameCallback` when available, with a playback-time fallback. Browser rendering and CPU load can miss short flashes. The displayed frame estimate and missed-presented-frame count describe observed processing; they do not certify that every encoded frame was analyzed. Camera auto-exposure and rolling shutter can also introduce apparent flicker.

**Audio notes are estimates of a prominent FFT peak.** The Web Audio analyzer uses an 8,192-sample FFT with peak interpolation, a noise gate, and approximately 65–4,000 Hz detection. A peak may be a harmonic. Speech, chords, noise, and weak audio are not reliably transcribed. Audio/video correlation has browser and FFT-window latency. No audio measurement is invented for silent media.

**Color-to-note mapping is a convention.** The default palette maps red→C, orange→D, yellow→E, green→F, cyan→G, indigo→A, violet→B. Neutral white/gray has no default assigned note. Custom references may associate different colors and notes. A color observation alone cannot recover an acoustic frequency or octave.

**A reference match is a candidate.** The decoder compares complete captured traces to reference note/color patterns and relative timing; it also tests Morse timing and prime pulse-group counts. Short or coincidental patterns can match. A match to SOS does not confirm an actual distress situation.

Transmission deliberately has no fast-strobe mode. On and off intervals are each at least 250 ms, and soft transitions are enabled initially. Flashing colors may still be uncomfortable for people sensitive to flashing lights; sound-only preview is available. Screen colors update on animation frames, while tones use the audio clock, so they are not calibrated laboratory synchronization.

## Data and privacy

Processing runs in this app on the device. There are no third-party scripts, analytics, media-upload requests, cloud inference calls, or remote runtime dependencies. GitHub Pages serves the app files. Sessions save measurements and a source filename, not the original video or photograph. Exports contain those measurements and filenames, so review them before sharing.

Browser storage can be cleared or evicted. Export sessions you want to keep. A saved session's Review button restores measurements; it cannot restore media that was never retained. Importing a dictionary validates note/color fields and bounds pattern sizes and timings.

## Development

Run the app over HTTP locally:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080` on the same computer. Camera access on an iPhone requires a secure HTTPS origin; a plain HTTP LAN address will usually not work.

Run the dependency-free processing tests with Node 20 or newer:

```sh
npm test
```

Files:

| File | Responsibility |
| --- | --- |
| `index.html` / `styles.css` | Responsive scanner, response deck, archive, dialogs |
| `engine.js` | RGB segmentation, pulse tracking, note conversion, FFT peak selection, pattern matching |
| `app.js` | Media lifecycle, Web Audio, rendering, transmission, persistence and exports |
| `manifest.webmanifest` / `sw.js` | Home Screen installation and offline app shell |
| `icons/` | Local SVG and PNG app icons |
| `tests/engine.test.js` | Deterministic signal-processing regression tests |
| `.github/workflows/check.yml` | Automated Node checks |

When releasing changes, update `VERSION` in `engine.js` and the cache name in `sw.js`. Reopen the hosted app online so the service worker can install the updated assets.

## iPhone acceptance check

Before relying on a session, test on the actual target iPhone:

- Camera permission granted and denied; microphone off and on; Stop releases capture.
- A short MP4 with a known blinking light and known sine tones; a silent MP4; portrait video; a still photo; an unsupported file.
- Region selection and threshold adjustment, pause/resume, restart, seeking, and the end of a clip.
- D–E–C–C–G synthetic test, SOS, custom dictionary export/import, and saved-session review.
- Sound preview, screen transmission, Stop, app backgrounding, and device lock.
- Home Screen launch, offline launch after the first online visit, and correct page loading under the repository's subdirectory.

Browser simulation and automated signal tests do not replace physical camera, microphone, speaker, and display validation on an iPhone.

## Platform references

- [GitHub Pages publishing configuration](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Camera and microphone capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Video-frame callbacks and timing limitations](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
- [Web Audio FFT analyzer](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode)
- [Screen wake locks](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
