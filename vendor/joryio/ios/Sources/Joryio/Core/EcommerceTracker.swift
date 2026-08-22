import Foundation

// MARK: - E-Commerce Types

/// Represents a product for e-commerce tracking
public struct EcommerceProduct {
    public let productId: String
    public let name: String
    public let price: Double
    public var quantity: Int?
    public var category: String?
    public var brand: String?
    public var variant: String?
    public var variantId: String?
    public var sku: String?
    public var imageUrl: String?
    public var url: String?

    public init(
        productId: String,
        name: String,
        price: Double,
        quantity: Int? = nil,
        category: String? = nil,
        brand: String? = nil,
        variant: String? = nil,
        variantId: String? = nil,
        sku: String? = nil,
        imageUrl: String? = nil,
        url: String? = nil
    ) {
        self.productId = productId
        self.name = name
        self.price = price
        self.quantity = quantity
        self.category = category
        self.brand = brand
        self.variant = variant
        self.variantId = variantId
        self.sku = sku
        self.imageUrl = imageUrl
        self.url = url
    }

    func toProperties() -> [String: Any] {
        var props: [String: Any] = [
            "product_id": productId,
            "name": name,
            "price": price
        ]
        if let quantity = quantity { props["quantity"] = quantity }
        if let category = category { props["category"] = category }
        if let brand = brand { props["brand"] = brand }
        if let variant = variant { props["variant"] = variant }
        if let variantId = variantId { props["variant_id"] = variantId }
        if let sku = sku { props["sku"] = sku }
        if let imageUrl = imageUrl { props["image_url"] = imageUrl }
        if let url = url { props["url"] = url }
        return props
    }
}

/// Represents a cart item (product with quantity)
public struct EcommerceCartItem {
    public let product: EcommerceProduct
    public let quantity: Int

    public init(product: EcommerceProduct, quantity: Int) {
        self.product = product
        self.quantity = quantity
    }

    public init(
        productId: String,
        name: String,
        price: Double,
        quantity: Int,
        category: String? = nil,
        brand: String? = nil,
        variant: String? = nil,
        variantId: String? = nil,
        sku: String? = nil,
        imageUrl: String? = nil,
        url: String? = nil
    ) {
        self.product = EcommerceProduct(
            productId: productId,
            name: name,
            price: price,
            quantity: quantity,
            category: category,
            brand: brand,
            variant: variant,
            variantId: variantId,
            sku: sku,
            imageUrl: imageUrl,
            url: url
        )
        self.quantity = quantity
    }

    var itemTotal: Double {
        return product.price * Double(quantity)
    }

    func toProperties() -> [String: Any] {
        var props = product.toProperties()
        props["quantity"] = quantity
        return props
    }
}

/// Represents an order
public struct EcommerceOrder {
    public let orderId: String
    public let items: [EcommerceCartItem]
    public let value: Double
    public var currency: String?
    public var shipping: Double?
    public var tax: Double?
    public var discount: Double?
    public var coupon: String?

    public init(
        orderId: String,
        items: [EcommerceCartItem],
        value: Double,
        currency: String? = nil,
        shipping: Double? = nil,
        tax: Double? = nil,
        discount: Double? = nil,
        coupon: String? = nil
    ) {
        self.orderId = orderId
        self.items = items
        self.value = value
        self.currency = currency
        self.shipping = shipping
        self.tax = tax
        self.discount = discount
        self.coupon = coupon
    }

    var itemCount: Int {
        return items.reduce(0) { $0 + $1.quantity }
    }
}

/// Configuration for e-commerce tracking
public struct EcommerceConfig {
    public var currency: String
    public var trackPageViews: Bool
    public var trackAddToCart: Bool

    public init(
        currency: String = "USD",
        trackPageViews: Bool = true,
        trackAddToCart: Bool = false
    ) {
        self.currency = currency
        self.trackPageViews = trackPageViews
        self.trackAddToCart = trackAddToCart
    }
}

// MARK: - E-Commerce Tracker

/// E-Commerce tracking helper class
/// Provides standardized e-commerce event tracking
public class EcommerceTracker {
    private let sdk: Joryio
    private let config: EcommerceConfig

    public init(sdk: Joryio = .shared, config: EcommerceConfig = EcommerceConfig()) {
        self.sdk = sdk
        self.config = config
    }

    // MARK: - Product Events

    /// Track when a user views a product
    public func viewProduct(_ product: EcommerceProduct) {
        var props = product.toProperties()
        props["currency"] = config.currency
        sdk.track("Product Viewed", properties: props)
    }

    /// Track when a user views a category/collection page
    public func viewCategory(categoryId: String, categoryName: String, properties: [String: Any] = [:]) {
        var props: [String: Any] = [
            "category_id": categoryId,
            "category_name": categoryName
        ]
        props.merge(properties) { _, new in new }
        sdk.track("Product List Viewed", properties: props)
    }

    /// Track when a user searches for products
    public func search(query: String, resultCount: Int? = nil, properties: [String: Any] = [:]) {
        var props: [String: Any] = ["query": query]
        if let resultCount = resultCount {
            props["result_count"] = resultCount
        }
        props.merge(properties) { _, new in new }
        sdk.track("Products Searched", properties: props)
    }

    // MARK: - Cart Events

    /// Track when a user adds an item to cart
    public func addToCart(item: EcommerceCartItem, cartValue: Double? = nil) {
        var props = item.toProperties()
        props["item_total"] = item.itemTotal
        props["currency"] = config.currency
        if let cartValue = cartValue {
            props["cart_value"] = cartValue
        }
        sdk.track("Product Added", properties: props)
    }

    /// Track when a user removes an item from cart
    public func removeFromCart(product: EcommerceProduct, quantity: Int = 1) {
        var props: [String: Any] = [
            "product_id": product.productId,
            "name": product.name,
            "price": product.price,
            "quantity": quantity,
            "currency": config.currency
        ]
        if let variantId = product.variantId {
            props["variant_id"] = variantId
        }
        if let sku = product.sku {
            props["sku"] = sku
        }
        sdk.track("Product Removed", properties: props)
    }

    /// Track when a user updates their cart
    public func updateCart(items: [EcommerceCartItem], cartValue: Double) {
        let itemCount = items.reduce(0) { $0 + $1.quantity }
        let itemsData = items.map { item -> [String: Any] in
            var data: [String: Any] = [
                "product_id": item.product.productId,
                "name": item.product.name,
                "price": item.product.price,
                "quantity": item.quantity
            ]
            if let variantId = item.product.variantId {
                data["variant_id"] = variantId
            }
            if let sku = item.product.sku {
                data["sku"] = sku
            }
            return data
        }

        sdk.track("Cart Updated", properties: [
            "items": itemsData,
            "item_count": itemCount,
            "cart_value": cartValue,
            "currency": config.currency
        ])
    }

    // MARK: - Checkout Events

    /// Track when a user starts checkout
    public func startCheckout(items: [EcommerceCartItem], cartValue: Double, properties: [String: Any] = [:]) {
        let itemCount = items.reduce(0) { $0 + $1.quantity }
        let itemsData = items.map { item -> [String: Any] in
            var data: [String: Any] = [
                "product_id": item.product.productId,
                "name": item.product.name,
                "price": item.product.price,
                "quantity": item.quantity
            ]
            if let variantId = item.product.variantId {
                data["variant_id"] = variantId
            }
            if let sku = item.product.sku {
                data["sku"] = sku
            }
            return data
        }

        var props: [String: Any] = [
            "items": itemsData,
            "item_count": itemCount,
            "value": cartValue,
            "currency": config.currency
        ]
        props.merge(properties) { _, new in new }
        sdk.track("Checkout Started", properties: props)
    }

    /// Track when a user adds payment info
    public func addPaymentInfo(paymentMethod: String, properties: [String: Any] = [:]) {
        var props: [String: Any] = ["payment_method": paymentMethod]
        props.merge(properties) { _, new in new }
        sdk.track("Payment Info Entered", properties: props)
    }

    // MARK: - Order Events

    /// Track when an order is placed
    public func purchase(order: EcommerceOrder) {
        let itemsData = order.items.map { item -> [String: Any] in
            var data: [String: Any] = [
                "product_id": item.product.productId,
                "name": item.product.name,
                "price": item.product.price,
                "quantity": item.quantity
            ]
            if let category = item.product.category {
                data["category"] = category
            }
            if let brand = item.product.brand {
                data["brand"] = brand
            }
            if let variantId = item.product.variantId {
                data["variant_id"] = variantId
            }
            if let sku = item.product.sku {
                data["sku"] = sku
            }
            return data
        }

        var props: [String: Any] = [
            "order_id": order.orderId,
            "items": itemsData,
            "item_count": order.itemCount,
            "value": order.value,
            "currency": order.currency ?? config.currency
        ]
        if let shipping = order.shipping { props["shipping"] = shipping }
        if let tax = order.tax { props["tax"] = tax }
        if let discount = order.discount { props["discount"] = discount }
        if let coupon = order.coupon { props["coupon"] = coupon }

        sdk.track("Order Completed", properties: props)
    }

    /// Track order fulfillment (shipped)
    public func orderFulfilled(orderId: String, trackingNumber: String? = nil, carrier: String? = nil) {
        var props: [String: Any] = ["order_id": orderId]
        if let trackingNumber = trackingNumber { props["tracking_number"] = trackingNumber }
        if let carrier = carrier { props["carrier"] = carrier }
        sdk.track("Order Fulfilled", properties: props)
    }

    /// Track order delivery
    public func orderDelivered(orderId: String) {
        sdk.track("Order Delivered", properties: ["order_id": orderId])
    }

    /// Track order cancellation
    public func orderCancelled(orderId: String, reason: String? = nil) {
        var props: [String: Any] = ["order_id": orderId]
        if let reason = reason { props["reason"] = reason }
        sdk.track("Order Cancelled", properties: props)
    }

    /// Track order refund
    public func orderRefunded(orderId: String, refundAmount: Double? = nil, reason: String? = nil) {
        var props: [String: Any] = ["order_id": orderId]
        if let refundAmount = refundAmount { props["refund_amount"] = refundAmount }
        if let reason = reason { props["reason"] = reason }
        sdk.track("Order Refunded", properties: props)
    }

    // MARK: - Wishlist Events

    /// Track product added to wishlist
    public func addToWishlist(product: EcommerceProduct) {
        var props: [String: Any] = [
            "product_id": product.productId,
            "name": product.name,
            "price": product.price,
            "currency": config.currency
        ]
        if let category = product.category { props["category"] = category }
        if let brand = product.brand { props["brand"] = brand }
        sdk.track("Product Added to Wishlist", properties: props)
    }

    /// Track product removed from wishlist
    public func removeFromWishlist(product: EcommerceProduct) {
        sdk.track("Product Removed from Wishlist", properties: [
            "product_id": product.productId,
            "name": product.name
        ])
    }

    // MARK: - Engagement Events

    /// Track product shared
    public func shareProduct(product: EcommerceProduct, shareMethod: String) {
        sdk.track("Product Shared", properties: [
            "product_id": product.productId,
            "name": product.name,
            "share_method": shareMethod
        ])
    }

    /// Track coupon applied
    public func applyCoupon(couponCode: String, discountAmount: Double? = nil, discountType: String? = nil) {
        var props: [String: Any] = ["coupon_code": couponCode]
        if let discountAmount = discountAmount { props["discount_amount"] = discountAmount }
        if let discountType = discountType { props["discount_type"] = discountType }
        sdk.track("Coupon Applied", properties: props)
    }

    /// Track coupon removed
    public func removeCoupon(couponCode: String) {
        sdk.track("Coupon Removed", properties: ["coupon_code": couponCode])
    }

    /// Track product review submitted
    public func submitReview(productId: String, rating: Int, reviewText: String? = nil) {
        var props: [String: Any] = [
            "product_id": productId,
            "rating": rating
        ]
        if let reviewText = reviewText { props["review_text"] = reviewText }
        sdk.track("Product Reviewed", properties: props)
    }
}

// MARK: - Joryio Extension

extension Joryio {
    /// Get the e-commerce tracker instance
    public func ecommerce(config: EcommerceConfig = EcommerceConfig()) -> EcommerceTracker {
        return EcommerceTracker(sdk: self, config: config)
    }
}
