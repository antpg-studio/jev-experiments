// Optical Laboratory: every editable production constant lives here.
// Times are seconds on the composition timeline. Coordinates for the Devin UI
// are in its own 1920x1080 space; phone focus points are normalized (0..1) on
// the Simulator screen, with crop widths as a fraction of the screen width.

export const VIDEO = { width: 1920, height: 1080, fps: 30, duration: 29.0 };

export const MEDIA = {
  // Frames extracted from the raw Simulator recording at VIDEO.fps
  // (see render/render.mjs). Frame 1 is the first frame of the take.
  framesDir: '../media/frames',
  framePattern: 'f%04d.jpg',
  frameCount: 641,
  sourceWidth: 1206,
  sourceHeight: 2622,
  // takeTime = compositionTime - takeOffset
  takeOffset: 10.4,
  // Real iOS home screen captured from the same Simulator (shown before launch)
  homeScreen: '../media/simulator-home.png',
  lockupWhite: '../assets/logos/devin-lockup-white.png',
  avatarWhite: '../assets/logos/devin-avatar-white.png',
  fontSans: '../assets/fonts/InterTight.ttf',
  fontMono: '../assets/fonts/JetBrainsMono.ttf',
};

export const BRAND = {
  field: '#0A0A0C',
  fieldGlow: 'rgba(38, 44, 92, 0.32)',
  text: '#ECECEE',
  textSecondary: '#8B8B94',
  textMuted: '#5E5E66',
  panel: '#121215',
  panelRaised: '#1A1A1F',
  hairline: 'rgba(255, 255, 255, 0.08)',
  hairlineStrong: 'rgba(255, 255, 255, 0.14)',
  accent: '#2200FF',
  accentSoft: 'rgba(96, 108, 255, 0.22)',
  accentText: '#9AA4FF',
  success: '#3DD68C',
  live: '#FF453A',
  inspectionStroke: 'rgba(255, 255, 255, 0.92)',
  inspectionLeader: 'rgba(255, 255, 255, 0.42)',
  code: {
    keyword: '#C792EA',
    type: '#7FDBFF',
    fn: '#82AAFF',
    number: '#F78C6C',
    string: '#C3E88D',
    comment: '#5E5E66',
    punct: '#9AA0B4',
    plain: '#D6D6DC',
  },
};

export const TEXT = {
  headline: 'macOS. Now in Devin Cloud.',
  endUrl: 'devin.ai',
  sessionTitle: 'Lumen Drift for iPhone',
  prompt:
    'Build Lumen Drift, a glowing lane dodging arcade game for iPhone, and play it in the Simulator',
  devinReply:
    'I will build Lumen Drift with SwiftUI and SpriteKit, then play it in the iPhone Simulator on my Mac.',
  devinFinal:
    'Lumen Drift runs in the Simulator. Steering, energy pickups, and pause and resume all work.',
  workedFor: 'Worked for 6m 48s',
  composerPlaceholder: 'Ask Devin to build features, fix bugs, or work on your code',
  composerModel: 'Devin',
  tabs: ['Progress', 'Changes', 'Computer', 'PR #241'],
  codeFile: 'lumen-drift/Core/DriftEngine.swift',
  simulatorDevice: 'iPhone 17',
  simulatorOS: 'iOS 26.5',
  menuBar: ['Simulator', 'File', 'Edit', 'Device', 'I/O', 'Features', 'Debug', 'Window', 'Help'],
  menuClock: 'Thu 17 Sep  11:37 PM',
};

// Timeline steps shown in the chat column (t = when the row appears).
export const STEPS = [
  { t: 8.4, label: 'Created LumenDrift.xcodeproj' },
  { t: 9.3, label: 'Wrote Core/DriftEngine.swift and CanyonScene.swift' },
  { t: 10.6, label: 'xcodebuild for iOS Simulator: BUILD SUCCEEDED' },
  { t: 11.3, label: 'Booted iPhone 17 Simulator and launched the app' },
  { t: 12.8, label: 'Tapped Start endless' },
  { t: 15.4, label: 'Steered between lanes to collect energy' },
  { t: 20.9, label: 'Paused the flight' },
  { t: 22.7, label: 'Resumed the flight' },
];

export const TIMING = {
  titleIn: 0.0,
  titleOut: 2.4,       // title starts fading, UI fades in
  uiIn: 2.5,
  typeStart: 3.3,
  typeEnd: 5.7,
  send: 6.15,          // prompt becomes a message
  reply: 6.7,
  changesTab: 7.6,     // code view opens
  codeStart: 7.8,
  codeEnd: 10.5,
  computerTab: 11.0,   // Simulator pane opens
  launch: 11.35,       // app launches in the Simulator (home screen -> take)
  observeIn: 11.9,     // UI eases back to reveal the inspection margin
  windowIn: 12.2,
  windowOut: 23.3,
  observeOut: 23.5,    // UI eases back to full view
  finalMessage: 24.3,
  endIn: 26.4,         // end card crossfade begins
  endHold: 29.0,
  ease: 1.0,           // duration of the full-view <-> observation move
  tabMove: 0.5,
};

// Field of view for the observation layout: the Devin UI is scaled about its
// left-center anchor so a dedicated margin opens on the right.
export const OBSERVE = { uiScale: 0.8, marginWidth: 384 };

// The single inspection window.
export const INSPECTION = {
  left: 1568,        // stage px
  top: 262,
  size: 320,         // stage px, square
  strokeWidth: 1.5,
  captionTop: 634,   // stage px, dedicated text margin
  captionSize: 30,
  fade: 0.35,        // caption crossfade seconds
  moveEase: 0.9,     // seconds to glide between focus regions
};

// Focus regions on the Simulator screen. cx, cy are normalized on the screen,
// w is the crop width as a fraction of the screen width (the crop is square).
// The window shows each region from its t until the next region's t.
export const FOCUS = [
  { t: 12.2, cx: 0.5, cy: 0.809, w: 0.62, caption: 'Devin taps Start endless' },
  { t: 13.7, cx: 0.5, cy: 0.70, w: 0.66, caption: 'Steers between lanes and collects energy' },
  { t: 16.6, cx: 0.29, cy: 0.15, w: 0.52, caption: 'Score climbs with every clean lane' },
  { t: 19.6, cx: 0.86, cy: 0.117, w: 0.34, caption: 'Pauses the run' },
  { t: 21.1, cx: 0.5, cy: 0.535, w: 0.86, caption: 'Resumes from the pause menu' },
];

// Cursor path inside the Devin UI (1920x1080 UI coordinates). "phone" entries
// are resolved against the Simulator screen at layout time.
export const CURSOR = [
  { t: 2.5, x: 900, y: 760 },
  { t: 3.1, el: 'composerText', dx: 40, dy: 14 },   // composer
  { t: 5.75, el: 'composerText', dx: 40, dy: 14 },
  { t: 6.1, el: 'sendBtn' },                  // send button
  { t: 7.1, el: 'sendBtn' },
  { t: 7.55, tab: 1 },                        // Changes tab
  { t: 10.55, tab: 1 },
  { t: 10.95, tab: 2 },                       // Computer tab
  { t: 11.7, tab: 2 },
  { t: 12.3, phone: [0.5, 0.809] },           // Start endless (tap at 12.42)
  { t: 14.6, phone: [0.5, 0.809] },
  { t: 15.0, phone: [0.2, 0.883] },           // lane LEFT (tap at 15.03)
  { t: 17.6, phone: [0.2, 0.883] },
  { t: 17.95, phone: [0.5, 0.883] },          // lane CENTER (tap at 17.96)
  { t: 20.0, phone: [0.5, 0.883] },
  { t: 20.45, phone: [0.88, 0.117] },         // pause (tap at 20.47)
  { t: 21.8, phone: [0.88, 0.117] },
  { t: 22.28, phone: [0.5, 0.527] },          // resume (tap at 22.30)
  { t: 22.5, phone: [0.5, 0.527] },
  { t: 22.74, phone: [0.8, 0.883] },          // lane RIGHT (tap at 22.74)
  { t: 24.2, phone: [0.8, 0.883] },
  { t: 24.55, phone: [0.5, 0.883] },          // lane CENTER (tap at 24.54)
  { t: 25.0, phone: [0.5, 0.883] },
  { t: 25.25, phone: [0.2, 0.883] },          // lane LEFT (tap at 25.22)
  { t: 25.45, phone: [0.2, 0.883] },
  { t: 25.62, phone: [0.8, 0.883] },          // lane RIGHT (tap at 25.60)
];

// Devin UI layout (UI space). The phone screen is derived from these.
export const LAYOUT = {
  chatWidth: 560,
  headerHeight: 56,
  macScreen: { x: 580, y: 96, w: 1320, h: 825 },
  menuBarHeight: 24,
  simToolbar: { w: 250, h: 40, top: 30 },
  phone: { screenW: 320, bezel: 12, radiusOuter: 56, top: 82 },
};

export const CODE = `mutating func steer(to lane: Int) {
  guard phase == .running else { return }
  self.lane = min(2, max(0, lane))
}

private mutating func resolve(_ wave: FlightWave) -> [FlightEvent] {
  if lane == wave.hazard {
    combo = 0
    if shields > 0 {
      shields -= 1
      return [.collision]
    }
    phase = .ended
    return [.collision, .gameOver]
  }
  var result: [FlightEvent] = []
  if abs(lane - wave.hazard) == 1 {
    combo += 1
    nearMisses += 1
    let points = 35 * multiplier
    bonus += points
    result.append(.nearMiss(points))
  } else {
    combo = 0
  }
  if lane == wave.energy {
    energy += 1
    let points = 100 * multiplier
    bonus += points
    result.append(.energy(points))
  }
  return result
}`;
