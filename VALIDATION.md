# Validation — 22 September 2026

## Passed

- **15 automated signal-engine tests**, run using `node --test tests/*.test.js`. Covers chromatic pitch and cents, FFT peak selection and silence rejection, connected-light segmentation, RGB measurement, single-pixel rejection, selected regions, target continuity, pulse debounce timing, color transitions, reference matching, Morse SOS/HELLO, prime grouping, custom color conventions, gap mismatch rejection, and dictionary input bounds.
- **DOM interaction smoke check**, using JSDOM with native canvas rendering and simulated audio interfaces. Covers startup without JavaScript errors, section navigation, preset selection, timing input bounds, dictionary save/load, disabled controls for an empty sequence, pad entry, sound-preview controls, and stopping scheduled tones when the document is hidden.
- **Encoded media integration fixture**: generated a six-second H.264/AAC MP4 at 30 fps, decoded all 180 frames and the audio soundtrack, then fed the decoded pixels and FFT spectra into the signal engine. It found five pulses, identified D4, E4, C4, C3, G3, matched the five-tone reference, and measured durations within one frame of the nominal 650 ms.
- JavaScript syntax checks for both application modules.

## Not yet verified

Live Safari, real iPhone camera/microphone permissions, actual speaker and screen output, codec support on the user's device, Home Screen installation, service-worker offline behavior, and final GitHub Pages deployment. The browser available during construction could not open local preview files. The DOM smoke check does not substitute for real browser or physical-device testing.

Use the iPhone acceptance checklist in `README.md` after deployment. The included synthetic MP4 supports a repeatable import test. Measurements remain frame-limited and are not calibrated scientific instrumentation.
