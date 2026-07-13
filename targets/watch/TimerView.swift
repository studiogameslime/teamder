// TimerView — the live match stopwatch. Counts up from the phone-resolved
// `baseElapsedMs` using the WATCH'S OWN monotonic uptime (ProcessInfo
// .systemUptime), so it stays in sync with the phone/other devices and is
// immune to wall-clock skew — the same fix the Wear companion uses.

import SwiftUI

struct TimerView: View {
  @EnvironmentObject var model: WatchModel

  var body: some View {
    // Re-render ~4×/sec while running so the seconds tick.
    TimelineView(.periodic(from: .now, by: 0.25)) { _ in
      let s = model.state
      VStack(spacing: 4) {
        Text(s?.title ?? "משחק חי")
          .font(.headline)
          .lineLimit(1)
          .minimumScaleFactor(0.6)

        Text(formatted(elapsedMs()))
          .font(.system(size: 40, weight: .bold, design: .rounded))
          .monospacedDigit()
          .foregroundColor(.blue)

        Text((s?.timer?.running ?? false) ? "המשחק רץ" : "מושהה")
          .font(.caption2)
          .foregroundColor(.secondary)

        if let by = s?.controlledByName, !by.isEmpty {
          Text("מנוהל ע״י \(by)")
            .font(.caption2)
            .foregroundColor(.secondary)
        }
      }
      .padding(.horizontal, 8)
    }
  }

  /// Elapsed ms right now: base + monotonic delta since the payload arrived
  /// (only while running).
  private func elapsedMs() -> Double {
    guard let t = model.state?.timer else { return 0 }
    if t.running {
      let deltaSec = ProcessInfo.processInfo.systemUptime - model.anchorUptime
      return t.baseElapsedMs + max(0, deltaSec) * 1000
    }
    return t.baseElapsedMs
  }

  private func formatted(_ ms: Double) -> String {
    let total = Int(ms / 1000)
    let h = total / 3600
    let m = (total % 3600) / 60
    let sec = total % 60
    return h > 0
      ? String(format: "%d:%02d:%02d", h, m, sec)
      : String(format: "%02d:%02d", m, sec)
  }
}
