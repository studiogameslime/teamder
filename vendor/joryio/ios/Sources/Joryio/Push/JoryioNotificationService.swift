import Foundation
import UserNotifications

/// Base class for a Notification Service Extension, so rich push images render.
///
/// APNs cannot attach an image itself. The payload carries the URL and sets
/// `mutable-content`, and an extension **inside the host app** downloads it and
/// attaches it before the notification is displayed. Apple requires that
/// extension to be a separate target in the app, so an SDK cannot ship it for
/// you - only the logic that goes in it, which is what this class is.
///
/// Without such an extension, a campaign image simply never appears on iOS:
/// the backend sets `mutable-content` correctly, and nothing acts on it. That
/// was the state before this class existed.
///
/// ## Adding it
///
/// 1. In Xcode: File > New > Target > **Notification Service Extension**.
/// 2. Add `Joryio` to that new target's dependencies.
/// 3. Replace the generated class with:
///
/// ```swift
/// import Joryio
///
/// class NotificationService: JoryioNotificationService {}
/// ```
///
/// That is the whole integration. Override `didReceive` if the app needs to do
/// its own work as well, and call `super`.
open class JoryioNotificationService: UNNotificationServiceExtension {

    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?

    /// How long we allow the image download. The system gives an extension ~30s
    /// total and then calls `serviceExtensionTimeWillExpire`; staying well under
    /// that means the notification is delivered WITH its image rather than being
    /// force-delivered without one.
    open var imageDownloadTimeout: TimeInterval { 10 }

    /// Cap on the downloaded image. A notification attachment does not need more,
    /// and an extension has a hard memory limit (24MB) that a large image can
    /// blow - taking the notification with it.
    open var maxImageBytes: Int { 10 * 1024 * 1024 }

    override open func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        let mutable = request.content.mutableCopy() as? UNMutableNotificationContent
        self.bestAttempt = mutable

        guard let mutable else {
            contentHandler(request.content)
            return
        }

        // Accept either key: `image_url` is what the Joryio backend sends, and
        // `attachment-url` is the convention several other tools use, so an app
        // migrating to us does not have to re-author its payloads.
        let raw = (request.content.userInfo["image_url"] as? String)
            ?? (request.content.userInfo["attachment-url"] as? String)

        guard let raw, let url = URL(string: raw), url.scheme?.lowercased() == "https" else {
            // No image, or not https. Deliver the notification unchanged rather
            // than dropping it - a missing picture must never cost the message.
            contentHandler(mutable)
            return
        }

        download(url) { [weak self] fileURL in
            guard let self else { return }
            defer { self.deliver() }
            guard let fileURL,
                  let attachment = try? UNNotificationAttachment(identifier: "joryio-image", url: fileURL)
            else { return }
            self.bestAttempt?.attachments = [attachment]
        }
    }

    /// The system is out of patience: deliver whatever we have, with or without
    /// the image. Failing to call the handler here means the user sees NOTHING.
    override open func serviceExtensionTimeWillExpire() {
        deliver()
    }

    private func deliver() {
        guard let handler = contentHandler, let content = bestAttempt else { return }
        // Nil them first: both this and serviceExtensionTimeWillExpire can fire,
        // and calling the content handler twice is undefined behaviour.
        contentHandler = nil
        bestAttempt = nil
        handler(content)
    }

    private func download(_ url: URL, completion: @escaping (URL?) -> Void) {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = imageDownloadTimeout
        config.timeoutIntervalForResource = imageDownloadTimeout

        URLSession(configuration: config).downloadTask(with: url) { [weak self] temp, response, _ in
            guard let self, let temp else { return completion(nil) }

            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                return completion(nil)
            }
            let attrs = try? FileManager.default.attributesOfItem(atPath: temp.path)
            let size = (attrs?[.size] as? Int) ?? 0
            if size > self.maxImageBytes { return completion(nil) }

            // The attachment must keep a file extension the system recognises, or
            // UNNotificationAttachment rejects it. The download's temp file has
            // none, so move it alongside with the URL's extension preserved.
            let ext = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
            let dest = URL(fileURLWithPath: NSTemporaryDirectory())
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(ext)
            do {
                try FileManager.default.moveItem(at: temp, to: dest)
                completion(dest)
            } catch {
                completion(nil)
            }
        }.resume()
    }
}
