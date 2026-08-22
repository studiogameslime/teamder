// WatchBridgeModule — iOS side of the Teamder Apple Watch relay. RN's
// watchSyncService calls publishState(json) whenever the user's games change;
// we forward the stringified WatchPayload to the paired Apple Watch over
// WatchConnectivity. The watch's WatchModel decodes the SAME JSON.
//
// Mirrors the Android WatchBridgeModule.kt (Wear Data Layer) — same "WatchBridge"
// name + publishState(json) contract, so the RN side is symmetric.

import ExpoModulesCore
import WatchConnectivity

public class WatchBridgeModule: Module, WCSessionDelegate {
  public func definition() -> ModuleDefinition {
    Name("WatchBridge")

    OnCreate {
      if WCSession.isSupported() {
        WCSession.default.delegate = self
        WCSession.default.activate()
      }
    }

    // True only when a paired Apple Watch actually has the Teamder watch app
    // installed — lets RN skip the Firestore listener for iOS users without one.
    Function("isWatchPaired") { () -> Bool in
      guard WCSession.isSupported() else { return false }
      let s = WCSession.default
      return s.isPaired && s.isWatchAppInstalled
    }

    AsyncFunction("publishState") { (json: String) in
      guard WCSession.isSupported() else { return }
      let session = WCSession.default
      let ctx: [String: Any] = ["json": json]
      // Latest-wins snapshot — delivered when the watch next wakes even if it's
      // asleep/unreachable now (the primary channel).
      try? session.updateApplicationContext(ctx)
      // Instant push when the watch app is foreground + reachable.
      if session.isReachable {
        session.sendMessage(ctx, replyHandler: nil, errorHandler: nil)
      }
    }
  }

  // WCSessionDelegate — required stubs on iOS. Re-activate after a watch swap
  // so the session keeps working when the user pairs a different watch.
  public func session(_ session: WCSession,
                      activationDidCompleteWith state: WCSessionActivationState,
                      error: Error?) {}
  public func sessionDidBecomeInactive(_ session: WCSession) {}
  public func sessionDidDeactivate(_ session: WCSession) {
    WCSession.default.activate()
  }
}
