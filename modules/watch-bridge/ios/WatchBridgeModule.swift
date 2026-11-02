// WatchBridgeModule — iOS side of the Teamder Apple Watch relay. RN's
// watchSyncService calls publishState(json) whenever the user's games change;
// we forward the stringified WatchPayload to the paired Apple Watch over
// WatchConnectivity. The watch's WatchModel decodes the SAME JSON.
//
// Mirrors the Android WatchBridgeModule.kt (Wear Data Layer) — same "WatchBridge"
// name + publishState(json) contract, so the RN side is symmetric.

import Foundation
import ExpoModulesCore
import WatchConnectivity
import SystemConfiguration

// Expo's Module is not an NSObject. WatchConnectivity requires an
// NSObjectProtocol delegate, so keep that responsibility in a retained adapter.
private final class WatchSessionDelegate: NSObject, WCSessionDelegate {
  private let onActivationError: () -> Void

  init(onActivationError: @escaping () -> Void) {
    self.onActivationError = onActivationError
    super.init()
  }

  func session(_ session: WCSession,
               activationDidCompleteWith state: WCSessionActivationState,
               error: Error?) {
    if error != nil { onActivationError() }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) {
    WCSession.default.activate()
  }
}

public class WatchBridgeModule: Module {
  private lazy var sessionDelegate = WatchSessionDelegate { [weak self] in
    self?.recordDiagnostic("watch.activation")
  }
  private let diagnosticLock = NSLock()
  private var diagnosticCodes: [String] = []
  private var diagnosticOverflow = false

  private func recordDiagnostic(_ code: String) {
    diagnosticLock.lock()
    defer { diagnosticLock.unlock() }
    if diagnosticCodes.count == 31 {
      diagnosticCodes.removeFirst()
      diagnosticOverflow = true
    }
    diagnosticCodes.append(code)
  }

  private func takeDiagnostics() -> [String] {
    diagnosticLock.lock()
    defer { diagnosticLock.unlock() }
    let result = diagnosticCodes + (diagnosticOverflow ? ["native.overflow"] : [])
    diagnosticCodes.removeAll(keepingCapacity: true)
    diagnosticOverflow = false
    return result
  }

  public func definition() -> ModuleDefinition {
    Name("WatchBridge")

    // Route flags only. No HTTP probes, Wi-Fi identifiers or permission prompts.
    AsyncFunction("getNetworkDiagnostics") { () -> [String: Any] in
      guard let route = SCNetworkReachabilityCreateWithName(nil, "0.0.0.0") else { return [:] }
      var flags = SCNetworkReachabilityFlags()
      guard SCNetworkReachabilityGetFlags(route, &flags) else { return [:] }
      let connected = flags.contains(.reachable) && !flags.contains(.connectionRequired)
      return ["networkConnected": connected, "internetReachable": "unknown",
        "networkType": connected ? (flags.contains(.isWWAN) ? "cellular" : "other") : "none"]
    }

    AsyncFunction("takeDiagnostics") { () -> [String] in
      self.takeDiagnostics()
    }

    OnCreate {
      if WCSession.isSupported() {
        WCSession.default.delegate = self.sessionDelegate
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
      do {
        try session.updateApplicationContext(ctx)
      } catch {
        self.recordDiagnostic("watch.context")
      }
      // Instant push when the watch app is foreground + reachable.
      if session.isReachable {
        session.sendMessage(ctx, replyHandler: nil, errorHandler: { [weak self] _ in
          self?.recordDiagnostic("watch.message")
        })
      }
    }
  }

}
