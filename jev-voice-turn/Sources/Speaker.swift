import AVFoundation
import Foundation

/// AVSpeechSynthesizer wrapper with a wall-clock fallback so the speaking phase always ends,
/// even on machines with no audio output device (where delegate callbacks may never arrive).
final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
  var onFinished: (() -> Void)?

  private let synth = AVSpeechSynthesizer()
  private var fallback: Timer?
  private var active = false
  private var minimumEnd = Date()

  override init() {
    super.init()
    synth.delegate = self
  }

  static func estimatedDuration(_ text: String) -> TimeInterval {
    let words = text.split(separator: " ").count
    return 0.4 + Double(words) * 0.33
  }

  func speak(_ text: String) {
    stop()
    active = true
    let utterance = AVSpeechUtterance(string: text)
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate
    synth.speak(utterance)
    let estimate = Speaker.estimatedDuration(text)
    minimumEnd = Date().addingTimeInterval(estimate * 0.8)
    schedule(after: estimate + 0.6)
  }

  private func schedule(after seconds: TimeInterval) {
    fallback?.invalidate()
    fallback = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
      self?.finish()
    }
  }

  func stop() {
    fallback?.invalidate()
    fallback = nil
    if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
    active = false
  }

  private func finish() {
    guard active else { return }
    fallback?.invalidate()
    fallback = nil
    active = false
    onFinished?()
  }

  /// Without an output device the synthesizer can report completion instantly; hold the
  /// speaking phase for most of the estimated duration so the demo timing stays realistic.
  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance)
  {
    DispatchQueue.main.async {
      guard self.active else { return }
      let remaining = self.minimumEnd.timeIntervalSinceNow
      if remaining > 0.05 { self.schedule(after: remaining) } else { self.finish() }
    }
  }
}
