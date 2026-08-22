import Foundation

/// User identity information
public struct UserIdentity: Codable {
    public var userId: String?
    public let anonymousId: String
    public var attributes: [String: AnyCodable]

    public init(userId: String?, anonymousId: String, attributes: UserAttributes = [:]) {
        self.userId = userId
        self.anonymousId = anonymousId
        self.attributes = attributes.mapValues { AnyCodable($0) }
    }

    enum CodingKeys: String, CodingKey {
        case userId
        case anonymousId
        case attributes
    }
}

/// User identification request
public struct IdentifyRequest: Codable {
    public let userId: String
    public let attributes: [String: AnyCodable]

    public init(userId: String, attributes: UserAttributes) {
        self.userId = userId
        self.attributes = attributes.mapValues { AnyCodable($0) }
    }
}

/// User alias request
public struct AliasRequest: Codable {
    public let anonymousId: String
    public let userId: String

    public init(anonymousId: String, userId: String) {
        self.anonymousId = anonymousId
        self.userId = userId
    }
}

/// Attribute-operations request (uses /v1/attributes to avoid $identify events).
///
/// Each section maps to an atomic backend operation; only the non-nil ones are
/// encoded (Swift omits nil optionals), so an increment sends a DELTA rather
/// than a locally-computed absolute and multi-device writes don't clobber:
///   - attributes: absolute `$set`
///   - increment:  `$inc`   (delta)
///   - append:     `$addToSet`
///   - remove:     `$pull`
///   - unset:      `$unset`
public struct SetAttributesRequest: Codable {
    public let userId: String?
    public let anonymousId: String
    public let attributes: [String: AnyCodable]?
    public let increment: [String: Double]?
    public let append: [String: AnyCodable]?
    public let remove: [String: AnyCodable]?
    public let unset: [String]?

    public init(
        userId: String?,
        anonymousId: String,
        attributes: UserAttributes? = nil,
        increment: [String: Double]? = nil,
        append: [String: Any]? = nil,
        remove: [String: Any]? = nil,
        unset: [String]? = nil
    ) {
        self.userId = userId
        self.anonymousId = anonymousId
        self.attributes = attributes.map { $0.mapValues { AnyCodable($0) } }
        self.increment = increment
        self.append = append.map { $0.mapValues { AnyCodable($0) } }
        self.remove = remove.map { $0.mapValues { AnyCodable($0) } }
        self.unset = unset
    }
}

/// Push token registration request
public struct PushTokenRequest: Codable {
    public let userId: String?
    public let anonymousId: String
    public let token: String
    public let platform: String
    public let deviceInfo: [String: AnyCodable]?

    public init(
        userId: String?,
        anonymousId: String,
        token: String,
        platform: String,
        deviceInfo: [String: Any]
    ) {
        self.userId = userId
        self.anonymousId = anonymousId
        self.token = token
        self.platform = platform
        self.deviceInfo = deviceInfo.isEmpty ? nil : deviceInfo.mapValues { AnyCodable($0) }
    }
}
