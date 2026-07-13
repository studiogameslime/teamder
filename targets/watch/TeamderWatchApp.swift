// Teamder watchOS app entry. Owns the WatchModel (WCSession) and routes the
// current phone state to the right screen.

import SwiftUI

@main
struct TeamderWatchApp: App {
  @StateObject private var model = WatchModel()

  var body: some Scene {
    WindowGroup {
      RootView().environmentObject(model)
    }
  }
}

struct RootView: View {
  @EnvironmentObject var model: WatchModel

  var body: some View {
    switch model.state?.kind {
    case .live:
      TimerView()
    case .upcoming, .scheduled:
      NextGameView()
    default:
      EmptyStateView()
    }
  }
}

struct EmptyStateView: View {
  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: "soccerball")
        .font(.system(size: 34))
        .foregroundColor(.blue)
      Text("אין משחק קרוב")
        .font(.headline)
        .multilineTextAlignment(.center)
      Text("פתח את Teamder בטלפון")
        .font(.caption2)
        .foregroundColor(.secondary)
    }
    .padding()
  }
}
