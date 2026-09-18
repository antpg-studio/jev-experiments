// Every editable constant for the Margin Notes launch video lives here.
// Times are seconds on the master timeline unless noted as "vt" (seconds into the Simulator take).
const CONFIG = {
  fps: 30,
  duration: 29.8,

  colors: {
    paper: '#F4EFE7',
  },

  text: {
    headline: 'macOS. Now in Devin Cloud.',
    placeholder: 'Ask Devin to build features, fix bugs, or work on your code',
    prompt: 'Build Silverroom, a photo darkroom for iPhone with Noir and Silver looks, then test it in the Simulator',
    noteMac: 'macOS selected',
    noteXcode: 'Built with Xcode',
    outroLine: 'Build native apps with Devin.',
    url: 'devin.ai',
  },

  layout: {
    marginX: 1480, // left edge of the reserved right margin where notes live
  },

  // genuine Simulator take, pre-extracted to JPEG frames by render.mjs
  take: {
    src: 'assets/silverroom-take.mov',
    framesDir: 'frames',
    frameCount: 437,
    duration: 14.56,
    width: 1206,
    height: 2622,
  },

  timeline: {
    title: { in: 0.0, out: 2.1 },
    composer: {
      in: 2.7, cursorStart: 3.6, menuOpen: 4.0, hoverMac: 4.45, macPick: 4.7,
      noteIn: 4.95, noteOut: 7.35, typeStart: 5.05, typeEnd: 7.05, send: 7.25, out: 7.85,
    },
    term: { in: 7.75, noteIn: 8.5, noteOut: 9.95, out: 10.45 },
    sim: { in: 10.8, videoStart: 11.0, recenter: 25.05, out: 26.05 },
    outro: { wipe: 25.85, lockup: 26.6, words: 27.15, url: 28.3, end: 29.8 },
  },

  // detail-panel focus keyframes (vt). cx/cy/w are fractions of the source frame; the crop
  // arrives at each keyframe at time t after moving for tr seconds.
  focus: [
    { t: 0.0, cx: 0.5, cy: 0.40, w: 0.85 },
    { t: 2.3, cx: 0.5, cy: 0.27, w: 0.80, tr: 0.7 },
    { t: 3.5, cx: 0.5, cy: 0.625, w: 0.70, tr: 0.6 },
    { t: 5.4, cx: 0.5, cy: 0.585, w: 0.70, tr: 0.6 },
    { t: 7.4, cx: 0.5, cy: 0.31, w: 0.85, tr: 0.6 },
    { t: 9.9, cx: 0.5, cy: 0.62, w: 0.70, tr: 0.6 },
    { t: 11.3, cx: 0.5, cy: 0.27, w: 0.80, tr: 0.6 },
    { t: 12.9, cx: 0.5, cy: 0.27, w: 0.72, tr: 0.6 },
  ],

  // one margin note at a time (vt). y is a fraction of the detail panel height.
  simNotes: [
    { text: 'Opening a photo', in: 1.3, out: 2.9, y: 0.42 },
    { text: 'Noir look', in: 3.5, out: 4.7, y: 0.5 },
    { text: 'Exposure up', in: 5.5, out: 6.9, y: 0.5 },
    { text: 'Hold to compare', in: 7.5, out: 8.9, y: 0.45 },
    { text: 'Rotated', in: 10.9, out: 11.9, y: 0.5 },
    { text: 'Square crop', in: 12.6, out: 13.6, y: 0.5 },
  ],
};
