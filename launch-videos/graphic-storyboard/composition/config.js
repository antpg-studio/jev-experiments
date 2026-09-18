// Graphic Storyboard: "macOS. Now in Devin Cloud."
// Every timing, caption, media path, panel rect and color lives here.
// Times are in seconds. Rects are [x, y, w, h] in the 1920x1080 frame.

window.CONFIG = {
  fps: 30,
  duration: 27.0,
  width: 1920,
  height: 1080,

  colors: {
    field: "#0f0f10",          // deep dark brand field behind the storyboard
    text: "#f4f4f5",
    muted: "#8b8b90",
    accent: "#2200ff",         // Devin brand blue (Figma)
    accentSoft: "#6b74ff",     // legible blue on dark surfaces
    ui: "#191919",             // Devin dark UI background (Figma)
    uiRaised: "#222224",
    uiLine: "rgba(255,255,255,0.08)",
    uiText: "#ececec",
    uiMuted: "#9a9a9f",
    green: "#3ddc84",
  },

  media: {
    macFrames: "../media/mac-frames/",       // screencapture -v, 30 fps jpg sequence
    macFrameCount: 480,
    iphoneFrames: "../media/iphone-frames/", // xcrun simctl recordVideo, 30 fps jpg sequence
    iphoneFrameCount: 540,
    lobby: "../assets/lobby-shared-world.png",
    lockup: "../assets/devin-lockup-white.png",
    avatar: "../assets/devin-avatar-white.png",
  },

  // Footage offsets: which second of each recording plays when a panel opens.
  footage: {
    macStart: 0.4,        // panel 3 (Mac build running)
    macFinalStart: 8.0,   // panel 6 (full frame result)
    iphoneStart: 0.6,     // panel 4 (iPhone build running)
  },

  text: {
    headline: "macOS. Now in Devin Cloud.",
    prompt: "Build VoxelHearth, a voxel sandbox for macOS and iPhone with shared worlds, and run both",
    sessionTitle: "Build VoxelHearth for macOS and iPhone",
    devinReply: "I will build VoxelHearth natively with SwiftUI and Metal, run the Mac app on my desktop and the iPhone app in the Simulator, then join both to one shared world.",
    devinDone: "VoxelHearth runs on both. I hosted room DQK43 from the Mac, joined it from the iPhone Simulator and placed torches from each device.",
    checks: [
      ["macOS app", "Running on Devin's Mac"],
      ["iPhone app", "Running in the Simulator"],
      ["Shared world DQK43", "Mac and iPhone joined"],
    ],
    endUrl: "devin.ai",
  },

  // Storyboard captions live in the bottom margin, aligned to the active panel.
  captions: [
    { t0: 3.0, t1: 6.3, x: 72, text: "Prompt" },
    { t0: 6.5, t1: 9.7, x: 796, text: "Devin writes Swift" },
    { t0: 10.1, t1: 14.1, x: 72, text: "Runs on Devin's Mac" },
    { t0: 14.5, t1: 18.3, x: 796, text: "Runs in the Simulator" },
    { t0: 18.7, t1: 21.4, x: 960, text: "Verified on both" },
  ],

  // Panel choreography. Each keyframe holds rect, opacity (o), zoom (z),
  // focus point in content pixels (f) and optional clip insets [top,right,bottom,left].
  panels: {
    prompt: {
      content: [1000, 430],
      keys: [
        { t: 2.6, rect: [72, 72, 700, 300], o: 0, z: 1, f: [500, 215], clip: [0, 700, 0, 0] },
        { t: 3.3, rect: [72, 72, 700, 300], o: 1, z: 1, f: [500, 215], clip: [0, 0, 0, 0] },
        { t: 5.4, rect: [72, 72, 700, 300], o: 1, z: 1, f: [500, 215] },
        { t: 6.1, rect: [72, 72, 700, 300], o: 1, z: 1.6, f: [330, 250] },
        { t: 9.6, rect: [72, 72, 700, 300], o: 1, z: 1.6, f: [330, 250] },
        { t: 10.4, rect: [72, 72, 700, 150], o: 0.55, z: 1.6, f: [330, 353] },
        { t: 21.4, rect: [72, 72, 700, 150], o: 0.55, z: 1.6, f: [330, 353] },
        { t: 22.2, rect: [72, 72, 700, 150], o: 0, z: 1.6, f: [330, 353] },
      ],
    },
    code: {
      content: [1052, 520],
      keys: [
        { t: 6.2, rect: [796, 72, 1052, 520], o: 0, z: 1, f: [526, 260], clip: [0, 1052, 0, 0] },
        { t: 6.9, rect: [796, 72, 1052, 520], o: 1, z: 1, f: [526, 260], clip: [0, 0, 0, 0] },
        { t: 9.6, rect: [796, 72, 1052, 520], o: 1, z: 1, f: [526, 260] },
        { t: 10.4, rect: [796, 72, 1052, 150], o: 0.55, z: 1, f: [526, 120] },
        { t: 21.4, rect: [796, 72, 1052, 150], o: 0.55, z: 1, f: [526, 120] },
        { t: 22.2, rect: [796, 72, 1052, 150], o: 0, z: 1, f: [526, 120] },
      ],
    },
    mac: {
      content: [1920, 1080],
      keys: [
        { t: 9.6, rect: [72, 246, 1163, 654], o: 0, z: 1, f: [960, 540], clip: [654, 0, 0, 0] },
        { t: 10.4, rect: [72, 246, 1163, 654], o: 1, z: 1, f: [960, 540], clip: [0, 0, 0, 0] },
        { t: 11.4, rect: [72, 246, 1163, 654], o: 1, z: 1, f: [960, 540] },
        { t: 13.0, rect: [72, 246, 1776, 654], o: 1, z: 1.55, f: [1300, 400] },
        { t: 14.0, rect: [72, 246, 1776, 654], o: 1, z: 1.55, f: [1300, 400] },
        { t: 14.8, rect: [72, 246, 700, 654], o: 0.6, z: 1.55, f: [1300, 400] },
        { t: 18.2, rect: [72, 246, 700, 654], o: 0.6, z: 1.55, f: [1300, 400] },
        { t: 19.0, rect: [72, 246, 340, 654], o: 0.55, z: 1.55, f: [1300, 400] },
        { t: 21.4, rect: [72, 246, 340, 654], o: 0.55, z: 1.55, f: [1300, 400] },
        { t: 22.2, rect: [72, 246, 340, 654], o: 0, z: 1.55, f: [1300, 400] },
      ],
    },
    iphone: {
      content: [1920, 1080],
      keys: [
        { t: 14.0, rect: [796, 246, 1052, 654], o: 0, z: 1, f: [1100, 540], clip: [0, 1052, 0, 0] },
        { t: 14.8, rect: [796, 246, 1052, 654], o: 1, z: 1, f: [1100, 540], clip: [0, 0, 0, 0] },
        { t: 15.6, rect: [796, 246, 1052, 654], o: 1, z: 1, f: [1100, 540] },
        { t: 17.6, rect: [796, 246, 1052, 654], o: 1, z: 1.5, f: [1260, 528] },
        { t: 18.2, rect: [796, 246, 1052, 654], o: 1, z: 1.5, f: [1260, 528] },
        { t: 19.0, rect: [436, 246, 500, 654], o: 0.6, z: 1.5, f: [1260, 528] },
        { t: 21.4, rect: [436, 246, 500, 654], o: 0.6, z: 1.5, f: [1260, 528] },
        { t: 22.2, rect: [436, 246, 500, 654], o: 0, z: 1.5, f: [1260, 528] },
      ],
    },
    verified: {
      content: [888, 654],
      keys: [
        { t: 18.2, rect: [960, 246, 888, 654], o: 0, z: 1, f: [444, 327], clip: [0, 888, 0, 0] },
        { t: 19.0, rect: [960, 246, 888, 654], o: 1, z: 1, f: [444, 327], clip: [0, 0, 0, 0] },
        { t: 21.4, rect: [960, 246, 888, 654], o: 1, z: 1, f: [444, 327] },
        { t: 22.2, rect: [960, 246, 888, 654], o: 0, z: 1, f: [444, 327] },
      ],
    },
    final: {
      content: [1920, 1080],
      keys: [
        { t: 21.4, rect: [960, 246, 888, 654], o: 0, z: 1, f: [960, 540] },
        { t: 21.9, rect: [960, 246, 888, 654], o: 1, z: 1, f: [960, 540] },
        { t: 22.9, rect: [0, 0, 1920, 1080], o: 1, z: 1, f: [960, 540], r: 0 },
        { t: 25.2, rect: [0, 0, 1920, 1080], o: 1, z: 1.03, f: [960, 540], r: 0 },
        { t: 25.9, rect: [0, 0, 1920, 1080], o: 0, z: 1.03, f: [960, 540], r: 0 },
      ],
    },
  },

  title: { t0: 0.0, t1: 2.9 },
  end: { t0: 25.5, t1: 27.0 },

  // Typing schedules (seconds) for the composer and the Swift editor.
  typing: {
    prompt: { t0: 3.3, t1: 5.3 },
    code: { t0: 6.8, t1: 9.4 },
  },
  panelRadius: 16,
};
