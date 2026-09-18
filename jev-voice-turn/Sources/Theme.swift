import SwiftUI

enum Theme {
  static let background = Color(red: 0.043, green: 0.059, blue: 0.078)
  static let panel = Color(red: 0.075, green: 0.102, blue: 0.133)
  static let panelBorder = Color.white.opacity(0.07)
  static let text = Color(red: 0.90, green: 0.93, blue: 0.95)
  static let muted = Color(red: 0.55, green: 0.61, blue: 0.68)
  static let jev = Color(red: 0.24, green: 0.86, blue: 0.52)
  static let baseline = Color(red: 1.0, green: 0.62, blue: 0.26)
  static let barge = Color(red: 1.0, green: 0.36, blue: 0.36)
  static let accent = Color(red: 0.50, green: 0.82, blue: 1.0)
  static let waveform = Color(red: 0.36, green: 0.48, blue: 0.62)

  static func mono(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
    .system(size: size, weight: weight, design: .monospaced)
  }
}

struct Panel<Content: View>: View {
  var title: String
  var subtitle: String? = nil
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text(title.uppercased())
          .font(.system(size: 11, weight: .bold))
          .tracking(1.2)
          .foregroundStyle(Theme.muted)
        if let subtitle {
          Text(subtitle)
            .font(.system(size: 11))
            .foregroundStyle(Theme.muted.opacity(0.8))
        }
        Spacer()
      }
      content
    }
    .padding(14)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.panelBorder))
  }
}

struct StatTile: View {
  var label: String
  var value: String
  var tint: Color = Theme.text
  var size: CGFloat = 26

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(label)
        .font(.system(size: 10, weight: .semibold))
        .tracking(0.8)
        .foregroundStyle(Theme.muted)
      Text(value)
        .font(Theme.mono(size))
        .foregroundStyle(tint)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
