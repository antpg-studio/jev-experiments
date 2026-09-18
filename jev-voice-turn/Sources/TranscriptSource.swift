import AVFoundation
import Foundation
import Speech

/// Something that produces a growing partial transcript for the current utterance.
protocol TranscriptSource: AnyObject {
  /// Full transcript of the utterance so far (the recognizer may revise earlier words).
  var onPartial: ((String) -> Void)? { get set }
  /// Input level in 0...1 for the waveform.
  var onLevel: ((Float) -> Void)? { get set }
  var onError: ((String) -> Void)? { get set }
  var onFinished: (() -> Void)? { get set }

  func start()
  func stop()
  /// The engine consumed the utterance; start a fresh transcript.
  func resetUtterance()
  func assistantPhaseChanged(_ phase: AssistantPhase)
}

/// Merges a revised partial transcript into the timed word list: new words get `now`,
/// revised words keep their original arrival time.
func mergeWords(_ existing: [TranscriptWord], partial: String, now: TimeInterval)
  -> [TranscriptWord]
{
  let tokens = partial.split(whereSeparator: { $0.isWhitespace }).map(String.init)
  var out: [TranscriptWord] = []
  for (i, t) in tokens.enumerated() {
    if i < existing.count {
      out.append(TranscriptWord(text: t, time: existing[i].time))
    } else {
      out.append(TranscriptWord(text: t, time: now))
    }
  }
  return out
}

/// Live microphone through Apple's on-device recognizer. Audio never leaves the machine.
final class LiveMicSource: NSObject, TranscriptSource {
  var onPartial: ((String) -> Void)?
  var onLevel: ((Float) -> Void)?
  var onError: ((String) -> Void)?
  var onFinished: (() -> Void)?

  private let audioEngine = AVAudioEngine()
  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var running = false

  var isOnDevice: Bool { recognizer?.supportsOnDeviceRecognition ?? false }

  func start() {
    SFSpeechRecognizer.requestAuthorization { [weak self] status in
      DispatchQueue.main.async {
        guard let self else { return }
        guard status == .authorized else {
          self.onError?("Speech recognition not authorized (\(status.rawValue))")
          return
        }
        self.startEngine()
      }
    }
  }

  private func startEngine() {
    guard let recognizer, recognizer.isAvailable else {
      onError?("Speech recognizer unavailable for en-US")
      return
    }
    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      onError?("No microphone input device. Use Simulated microphone mode.")
      return
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      guard let self else { return }
      self.request?.append(buffer)
      if let data = buffer.floatChannelData?[0] {
        let n = Int(buffer.frameLength)
        var sum: Float = 0
        for i in 0..<n { sum += data[i] * data[i] }
        let rms = n > 0 ? sqrt(sum / Float(n)) : 0
        let level = min(1, rms * 8)
        DispatchQueue.main.async { self.onLevel?(level) }
      }
    }
    do {
      audioEngine.prepare()
      try audioEngine.start()
    } catch {
      onError?("Audio engine failed: \(error.localizedDescription)")
      return
    }
    running = true
    beginRequest()
  }

  private func beginRequest() {
    guard running, let recognizer else { return }
    task?.cancel()
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    if recognizer.supportsOnDeviceRecognition {
      req.requiresOnDeviceRecognition = true
    }
    request = req
    task = recognizer.recognitionTask(with: req) { [weak self] result, error in
      DispatchQueue.main.async {
        guard let self, self.request === req else { return }
        if let result {
          self.onPartial?(result.bestTranscription.formattedString)
          if result.isFinal { self.beginRequest() }
        }
        if let error {
          let ns = error as NSError
          // 216/301 = task cancelled by us; 1110 = no speech detected, just restart.
          if ns.code != 216 && ns.code != 301 && ns.code != 1110 {
            self.onError?(error.localizedDescription)
          }
          if self.running { self.beginRequest() }
        }
      }
    }
  }

  func resetUtterance() {
    request?.endAudio()
    beginRequest()
  }

  func assistantPhaseChanged(_ phase: AssistantPhase) {}

  func stop() {
    running = false
    task?.cancel()
    task = nil
    request?.endAudio()
    request = nil
    if audioEngine.isRunning {
      audioEngine.inputNode.removeTap(onBus: 0)
      audioEngine.stop()
    }
  }
}
