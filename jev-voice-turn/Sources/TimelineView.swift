import SwiftUI

/// Scrolling strip: waveform, words as they arrive, Jev's turn_complete probability,
/// and the moments Jev fired versus when a fixed-silence endpointer would have.
struct TimelineView: View {
  @EnvironmentObject var engine: SessionEngine
  var windowSeconds: Double = 10
  var lookahead: Double = 1.6

  var body: some View {
    Canvas { ctx, size in
      let windowEnd = engine.now + lookahead
      let w = size.width
      let h = size.height
      let probTop: CGFloat = 26
      let probBottom: CGFloat = h * 0.58
      let waveMid: CGFloat = h * 0.80
      let waveAmp: CGFloat = h * 0.16
      func x(_ t: TimeInterval) -> CGFloat {
        CGFloat(
          TimelineMath.x(for: t, windowEnd: windowEnd, windowSeconds: windowSeconds, width: w))
      }
      func y(_ p: Double) -> CGFloat { probBottom - CGFloat(p) * (probBottom - probTop) }

      // Grid: one line per second.
      let firstSecond = ceil(windowEnd - windowSeconds)
      var s = firstSecond
      while s <= windowEnd {
        let gx = x(s)
        var p = Path()
        p.move(to: CGPoint(x: gx, y: 0))
        p.addLine(to: CGPoint(x: gx, y: h))
        ctx.stroke(p, with: .color(.white.opacity(0.05)), lineWidth: 1)
        ctx.draw(
          Text(String(format: "%.0fs", s)).font(.system(size: 9, design: .monospaced))
            .foregroundColor(Theme.muted.opacity(0.7)),
          at: CGPoint(x: gx + 3, y: h - 8), anchor: .leading)
        s += 1
      }

      // Future region (right of now).
      let nowX = x(engine.now)
      ctx.fill(
        Path(CGRect(x: nowX, y: 0, width: w - nowX, height: h)), with: .color(.white.opacity(0.025))
      )

      // Waveform.
      var wave = Path()
      for l in engine.levels where l.time >= windowEnd - windowSeconds {
        let lx = x(l.time)
        let a = max(1, CGFloat(l.level) * waveAmp)
        wave.move(to: CGPoint(x: lx, y: waveMid - a))
        wave.addLine(to: CGPoint(x: lx, y: waveMid + a))
      }
      ctx.stroke(wave, with: .color(Theme.waveform), lineWidth: 1.5)

      // Saved-time bands: from each fire marker to the baseline marker that follows it.
      let markers = engine.markers.sorted { $0.time < $1.time }
      var pendingFire: TimeInterval?
      for m in markers {
        switch m.kind {
        case .fired(.jev): pendingFire = m.time
        case .fired: pendingFire = nil
        case .baselineWouldFire:
          if let f = pendingFire, m.time > f {
            let rect = CGRect(
              x: x(f), y: probTop - 6, width: x(m.time) - x(f), height: probBottom - probTop + 12)
            ctx.fill(Path(rect), with: .color(Theme.jev.opacity(0.10)))
            let label = String(format: "saved %.0f ms", (m.time - f) * 1000)
            ctx.draw(
              Text(label).font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(Theme.jev),
              at: CGPoint(x: rect.midX, y: probTop - 12), anchor: .center)
          }
          pendingFire = nil
        case .bargeIn: break
        }
      }

      // Threshold line.
      var th = Path()
      th.move(to: CGPoint(x: 0, y: y(engine.policy.fireThreshold)))
      th.addLine(to: CGPoint(x: w, y: y(engine.policy.fireThreshold)))
      ctx.stroke(
        th, with: .color(Theme.jev.opacity(0.5)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
      ctx.draw(
        Text(String(format: "fire ≥ %.2f", engine.policy.fireThreshold))
          .font(.system(size: 9, design: .monospaced)).foregroundColor(Theme.jev.opacity(0.8)),
        at: CGPoint(x: 6, y: y(engine.policy.fireThreshold) - 8), anchor: .leading)

      // turn_complete probability as a step line, broken at each fire.
      let fires = Set(
        markers.compactMap { m -> TimeInterval? in
          if case .fired = m.kind { return m.time }
          return nil
        })
      var segment: [(time: TimeInterval, value: Double)] = []
      func flush(until end: TimeInterval) {
        let pts = TimelineMath.probabilityPath(samples: segment, until: end)
        guard pts.count > 1 else { return }
        var path = Path()
        path.move(to: CGPoint(x: x(pts[0].time), y: y(pts[0].value)))
        for pt in pts.dropFirst() { path.addLine(to: CGPoint(x: x(pt.time), y: y(pt.value))) }
        ctx.stroke(path, with: .color(Theme.accent), lineWidth: 2)
        for pt in segment {
          ctx.fill(
            Path(ellipseIn: CGRect(x: x(pt.time) - 2.5, y: y(pt.value) - 2.5, width: 5, height: 5)),
            with: .color(Theme.accent))
        }
        segment = []
      }
      let sortedFires = fires.sorted()
      var fireIdx = 0
      for smp in engine.samples.sorted(by: { $0.time < $1.time }) {
        while fireIdx < sortedFires.count && sortedFires[fireIdx] < smp.time {
          flush(until: sortedFires[fireIdx])
          fireIdx += 1
        }
        segment.append((smp.time, smp.turnComplete))
      }
      flush(until: fireIdx < sortedFires.count ? sortedFires[fireIdx] : engine.now)

      // Words.
      for word in engine.wordHistory where word.time >= windowEnd - windowSeconds {
        let wx = x(word.time)
        var tick = Path()
        tick.move(to: CGPoint(x: wx, y: probBottom + 4))
        tick.addLine(to: CGPoint(x: wx, y: probBottom + 12))
        ctx.stroke(tick, with: .color(Theme.text.opacity(0.6)), lineWidth: 1)
        ctx.draw(
          Text(word.text).font(.system(size: 11, weight: .medium)).foregroundColor(Theme.text),
          at: CGPoint(x: wx + 2, y: probBottom + 20), anchor: .leading)
      }

      // Markers.
      for m in markers {
        let mx = x(m.time)
        let (color, label, dash): (Color, String, [CGFloat]) = {
          switch m.kind {
          case .fired(.jev): return (Theme.jev, "JEV FIRED", [])
          case .fired(let src): return (Theme.baseline, src.rawValue.uppercased(), [])
          case .baselineWouldFire: return (Theme.baseline, "SILENCE BASELINE", [3, 3])
          case .bargeIn: return (Theme.barge, "BARGE-IN", [])
          }
        }()
        var line = Path()
        line.move(to: CGPoint(x: mx, y: 12))
        line.addLine(to: CGPoint(x: mx, y: h - 14))
        ctx.stroke(line, with: .color(color), style: StrokeStyle(lineWidth: 1.5, dash: dash))
        let leading = m.kind == .baselineWouldFire || m.kind == .bargeIn
        let anchor: UnitPoint = leading ? .topLeading : .topTrailing
        let dx: CGFloat = leading ? 4 : -4
        let dy: CGFloat = m.kind == .bargeIn ? 16 : 4
        ctx.draw(
          Text(label).font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundColor(
            color),
          at: CGPoint(x: mx + dx, y: dy), anchor: anchor)
      }

      // Now line.
      var nowLine = Path()
      nowLine.move(to: CGPoint(x: nowX, y: 0))
      nowLine.addLine(to: CGPoint(x: nowX, y: h))
      ctx.stroke(nowLine, with: .color(.white.opacity(0.5)), lineWidth: 1)
    }
    .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
  }
}
