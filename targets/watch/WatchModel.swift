// WatchModel — receives the phone's WatchPayload over WatchConnectivity and
// exposes it to SwiftUI. Mirror of the Wear companion's data layer: the phone
// is the brain (talks to Firebase); the watch is a thin client that renders the
// live timer + next game from whatever the phone last published.
//
// Contract: the iOS app's WatchBridge sends `["json": <stringified WatchPayload>]`
// via WCSession.updateApplicationContext (latest-wins) AND sendMessage (instant
// when reachable). Same JSON shape produced by src/services/watchSyncService.ts.

import Foundation
import WatchConnectivity

// MARK: - Decoded payload

enum WatchKind: String, Decodable {
  case live, upcoming, scheduled, notRegistered
}

struct WatchTimer: Decodable {
  let running: Bool
  let lastStartedAt: Double
  let accumulatedMs: Double
  // Fully-resolved elapsed ms at the publish instant, in NO device's clock base.
  // The watch counts up from this using its OWN monotonic uptime.
  let baseElapsedMs: Double
}

struct WatchPlayer: Decodable, Identifiable {
  let name: String
  let role: String?
  var id: String { name + (role ?? "") }
}

// The union flattened to optionals — `kind` discriminates which fields are set.
struct WatchState: Decodable {
  let clockOffsetMs: Double
  let serverNowMs: Double
  let kind: WatchKind

  let gameId: String?
  let title: String?
  let timer: WatchTimer?
  let controlledByName: String?
  let startsAt: Double?
  let registrationOpensAt: Double?
  let fieldName: String?
  let city: String?
  let playersCount: Int?
  let maxPlayers: Int?
  let players: [WatchPlayer]?
}

// MARK: - Connectivity model

final class WatchModel: NSObject, ObservableObject, WCSessionDelegate {
  @Published var state: WatchState?
  /// The watch's monotonic uptime captured the instant a payload arrived — the
  /// anchor the timer counts up from (immune to wall-clock changes).
  @Published var anchorUptime: TimeInterval = ProcessInfo.processInfo.systemUptime

  override init() {
    super.init()
    if WCSession.isSupported() {
      let s = WCSession.default
      s.delegate = self
      s.activate()
      // Render whatever the phone last published even before a live message.
      apply(context: s.receivedApplicationContext)
    }
  }

  private func apply(context: [String: Any]) {
    guard let json = context["json"] as? String,
          let data = json.data(using: .utf8),
          let decoded = try? JSONDecoder().decode(WatchState.self, from: data)
    else { return }
    DispatchQueue.main.async {
      self.anchorUptime = ProcessInfo.processInfo.systemUptime
      self.state = decoded
    }
  }

  // Latest-wins snapshot (survives relaunch / delivered when the watch wakes).
  func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
    apply(context: context)
  }

  // Instant push while both apps are foregrounded + reachable.
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    apply(context: message)
  }

  func session(_ session: WCSession,
               activationDidCompleteWith state: WCSessionActivationState,
               error: Error?) {}
}
