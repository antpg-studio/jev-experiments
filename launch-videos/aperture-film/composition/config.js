// Editable constants for The Aperture Film.
// All times are in seconds on the film timeline. Frame rate is fixed at 30 fps.

window.CONFIG = {
  fps: 30,
  duration: 29.8,
  width: 1920,
  height: 1080,

  // Verified brand palette (sampled from the Devin light UI and dark brand field).
  colors: {
    paper: "#F4F3EF", // solid matte the aperture cuts through
    page: "#FBFBFA", // Devin light UI page background
    surface: "#FFFFFF",
    ink: "#141414",
    inkSoft: "#5F6368",
    hairline: "rgba(20,20,20,0.10)",
    pill: "#F1F1F0",
    accentBlueText: "#2F6FED",
    accentBlueBg: "#E8F0FE",
    success: "#1A7F37",
    working: "#E0742A",
    dark: "#0A0A0B",
  },

  // Copy. No em dashes anywhere.
  text: {
    headline: "macOS. Now in Devin Cloud.",
    prompt:
      "Build Silverroom, a photo darkroom for iPhone with Noir and Silver looks, then test it in the Simulator",
    placeholder: "Ask Devin to build features, fix bugs, or work on your code",
    sessionTitle: "Build Silverroom for iPhone",
    devinReply:
      "I will build Silverroom with SwiftUI and Core Image, run it in the iOS Simulator on my Mac, and test the Noir look, exposure and frame tools.",
    steps: [
      "Built Silverroom for iPhone 17 Pro",
      "Launched the iOS Simulator",
      "Testing Noir, exposure and frame tools",
    ],
    launchLine: "Build, run and test native apps on Devin's Mac.",
    url: "devin.ai",
  },

  // Media paths, relative to composition/index.html
  media: {
    lockupBlack: "../assets/logo/devin-lockup-black.png",
    lockupWhite: "../assets/logo/devin-lockup-white.png",
    avatarBlack: "../assets/logo/devin-avatar-black.png",
    // Frames extracted from the genuine Simulator take (see README, render.sh).
    takeFramesDir: "../frames/take/",
    takeFrameCount: 464,
  },

  // Timeline (seconds). Edit these to retime the film.
  t: {
    headlineOut: 1.9,
    apertureToComposer: [1.9, 2.8],
    cursorIn: 2.6,
    chipClick: 3.15,
    menuOpen: 3.2,
    macClick: 4.05,
    menuClose: 4.15,
    typeStart: 4.8,
    typeEnd: 7.2,
    submitPress: 7.45,
    apertureClose1: [7.55, 7.95],
    codeOpen: [7.95, 8.4],
    codeType: [8.0, 9.6],
    apertureClose2: [9.6, 9.95],
    footageOpen: [9.95, 10.45],
    footageStart: 10.2, // first take frame appears here; the take then plays at 1x
    outroFullCanvas: [25.35, 26.15],
    outroToDark: [26.65, 27.45],
    logoIn: [27.25, 27.85],
    wordsStart: 27.95,
    wordStep: 0.11,
    urlIn: 29.05,
  },
};
