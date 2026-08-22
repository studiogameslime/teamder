package io.joryio.sdk.ecommerce

import io.joryio.sdk.Joryio

/**
 * Represents a product for e-commerce tracking
 */
data class EcommerceProduct(
    val productId: String,
    val name: String,
    val price: Double,
    val quantity: Int? = null,
    val category: String? = null,
    val brand: String? = null,
    val variant: String? = null,
    val variantId: String? = null,
    val sku: String? = null,
    val imageUrl: String? = null,
    val url: String? = null
) {
    fun toProperties(): Map<String, Any?> = buildMap {
        put("product_id", productId)
        put("name", name)
        put("price", price)
        quantity?.let { put("quantity", it) }
        category?.let { put("category", it) }
        brand?.let { put("brand", it) }
        variant?.let { put("variant", it) }
        variantId?.let { put("variant_id", it) }
        sku?.let { put("sku", it) }
        imageUrl?.let { put("image_url", it) }
        url?.let { put("url", it) }
    }
}

/**
 * Represents a cart item (product with quantity)
 */
data class EcommerceCartItem(
    val productId: String,
    val name: String,
    val price: Double,
    val quantity: Int,
    val category: String? = null,
    val brand: String? = null,
    val variant: String? = null,
    val variantId: String? = null,
    val sku: String? = null,
    val imageUrl: String? = null,
    val url: String? = null
) {
    val itemTotal: Double get() = price * quantity

    fun toProduct(): EcommerceProduct = EcommerceProduct(
        productId = productId,
        name = name,
        price = price,
        quantity = quantity,
        category = category,
        brand = brand,
        variant = variant,
        variantId = variantId,
        sku = sku,
        imageUrl = imageUrl,
        url = url
    )

    fun toProperties(): Map<String, Any?> = buildMap {
        put("product_id", productId)
        put("name", name)
        put("price", price)
        put("quantity", quantity)
        category?.let { put("category", it) }
        brand?.let { put("brand", it) }
        variant?.let { put("variant", it) }
        variantId?.let { put("variant_id", it) }
        sku?.let { put("sku", it) }
        imageUrl?.let { put("image_url", it) }
        url?.let { put("url", it) }
    }
}

/**
 * Represents an order
 */
data class EcommerceOrder(
    val orderId: String,
    val items: List<EcommerceCartItem>,
    val value: Double,
    val currency: String? = null,
    val shipping: Double? = null,
    val tax: Double? = null,
    val discount: Double? = null,
    val coupon: String? = null
) {
    val itemCount: Int get() = items.sumOf { it.quantity }
}

/**
 * Configuration for e-commerce tracking
 */
data class EcommerceConfig(
    val currency: String = "USD",
    val trackPageViews: Boolean = true,
    val trackAddToCart: Boolean = false
)

/**
 * E-Commerce tracking helper class
 * Provides standardized e-commerce event tracking
 */
class EcommerceTracker(
    private val sdk: Joryio = Joryio.getInstance(),
    private val config: EcommerceConfig = EcommerceConfig()
) {

    // MARK: - Product Events

    /**
     * Track when a user views a product
     */
    fun viewProduct(product: EcommerceProduct) {
        val props = product.toProperties().toMutableMap()
        props["currency"] = config.currency
        sdk.track("Product Viewed", props)
    }

    /**
     * Track when a user views a category/collection page
     */
    fun viewCategory(
        categoryId: String,
        categoryName: String,
        properties: Map<String, Any?> = emptyMap()
    ) {
        val props = mutableMapOf<String, Any?>(
            "category_id" to categoryId,
            "category_name" to categoryName
        )
        props.putAll(properties)
        sdk.track("Product List Viewed", props)
    }

    /**
     * Track when a user searches for products
     */
    fun search(
        query: String,
        resultCount: Int? = null,
        properties: Map<String, Any?> = emptyMap()
    ) {
        val props = mutableMapOf<String, Any?>("query" to query)
        resultCount?.let { props["result_count"] = it }
        props.putAll(properties)
        sdk.track("Products Searched", props)
    }

    // MARK: - Cart Events

    /**
     * Track when a user adds an item to cart
     */
    fun addToCart(item: EcommerceCartItem, cartValue: Double? = null) {
        val props = item.toProperties().toMutableMap()
        props["item_total"] = item.itemTotal
        props["currency"] = config.currency
        cartValue?.let { props["cart_value"] = it }
        sdk.track("Product Added", props)
    }

    /**
     * Track when a user removes an item from cart
     */
    fun removeFromCart(product: EcommerceProduct, quantity: Int = 1) {
        val props = mutableMapOf<String, Any?>(
            "product_id" to product.productId,
            "name" to product.name,
            "price" to product.price,
            "quantity" to quantity,
            "currency" to config.currency
        )
        product.variantId?.let { props["variant_id"] = it }
        product.sku?.let { props["sku"] = it }
        sdk.track("Product Removed", props)
    }

    /**
     * Track when a user updates their cart
     */
    /**
     * Track the cart being viewed.
     *
     * `Cart Viewed` has been canonical all along, but no tracker had a method
     * for it - so the only way to send it was to type the name by hand, which
     * is the habit these trackers exist to remove. Same payload as
     * [updateCart]: the cart is the same thing either way.
     */
    fun cartViewed(items: List<EcommerceCartItem>, cartValue: Double) {
        sdk.track("Cart Viewed", mapOf(
            "items" to items.map { item ->
                buildMap<String, Any?> {
                    put("product_id", item.productId)
                    put("name", item.name)
                    put("price", item.price)
                    put("quantity", item.quantity)
                    item.variantId?.let { put("variant_id", it) }
                    item.sku?.let { put("sku", it) }
                }
            },
            "item_count" to items.sumOf { it.quantity },
            "cart_value" to cartValue,
            "currency" to config.currency
        ))
    }

    fun updateCart(items: List<EcommerceCartItem>, cartValue: Double) {
        val itemCount = items.sumOf { it.quantity }
        val itemsData = items.map { item ->
            buildMap<String, Any?> {
                put("product_id", item.productId)
                put("name", item.name)
                put("price", item.price)
                put("quantity", item.quantity)
                item.variantId?.let { put("variant_id", it) }
                item.sku?.let { put("sku", it) }
            }
        }

        sdk.track("Cart Updated", mapOf(
            "items" to itemsData,
            "item_count" to itemCount,
            "cart_value" to cartValue,
            "currency" to config.currency
        ))
    }

    // MARK: - Checkout Events

    /**
     * Track when a user starts checkout
     */
    fun startCheckout(
        items: List<EcommerceCartItem>,
        cartValue: Double,
        properties: Map<String, Any?> = emptyMap()
    ) {
        val itemCount = items.sumOf { it.quantity }
        val itemsData = items.map { item ->
            buildMap<String, Any?> {
                put("product_id", item.productId)
                put("name", item.name)
                put("price", item.price)
                put("quantity", item.quantity)
                item.variantId?.let { put("variant_id", it) }
                item.sku?.let { put("sku", it) }
            }
        }

        val props = mutableMapOf<String, Any?>(
            "items" to itemsData,
            "item_count" to itemCount,
            "value" to cartValue,
            "currency" to config.currency
        )
        props.putAll(properties)
        sdk.track("Checkout Started", props)
    }

    /**
     * Track when a user adds payment info
     */
    fun addPaymentInfo(paymentMethod: String, properties: Map<String, Any?> = emptyMap()) {
        val props = mutableMapOf<String, Any?>("payment_method" to paymentMethod)
        props.putAll(properties)
        sdk.track("Payment Info Entered", props)
    }

    // MARK: - Order Events

    /**
     * Track when an order is placed
     */
    fun purchase(order: EcommerceOrder) {
        val itemsData = order.items.map { item ->
            buildMap<String, Any?> {
                put("product_id", item.productId)
                put("name", item.name)
                put("price", item.price)
                put("quantity", item.quantity)
                item.category?.let { put("category", it) }
                item.brand?.let { put("brand", it) }
                item.variantId?.let { put("variant_id", it) }
                item.sku?.let { put("sku", it) }
            }
        }

        val props = mutableMapOf<String, Any?>(
            // `total` and `orderId`, NOT `value` and `order_id`.
            //
            // The revenue pipeline reads exactly these two keys - see
            // purchase-vocabulary.ts, which says of `value`/`revenue`: "somebody
            // else's convention", and of `order_id`: "a key nothing reads".
            // Every purchase tracked through this tracker therefore landed as
            // ZERO revenue with no order id for attribution, on all three SDKs.
            //
            // Not a crash, not a warning: a $0 order that looks like an order.
            // The demo app hit the same thing and its comment already warned
            // about it - the SDK it was warning about never got fixed.
            "orderId" to order.orderId,
            "items" to itemsData,
            "item_count" to order.itemCount,
            "total" to order.value,
            "currency" to (order.currency ?: config.currency)
        )
        order.shipping?.let { props["shipping"] = it }
        order.tax?.let { props["tax"] = it }
        order.discount?.let { props["discount"] = it }
        order.coupon?.let { props["coupon"] = it }

        sdk.track("Order Completed", props)
    }

    /**
     * Track order fulfillment (shipped)
     */
    fun orderFulfilled(orderId: String, trackingNumber: String? = null, carrier: String? = null) {
        val props = mutableMapOf<String, Any?>("order_id" to orderId)
        trackingNumber?.let { props["tracking_number"] = it }
        carrier?.let { props["carrier"] = it }
        sdk.track("Order Fulfilled", props)
    }

    /**
     * Track order delivery
     */
    fun orderDelivered(orderId: String) {
        sdk.track("Order Delivered", mapOf("order_id" to orderId))
    }

    /**
     * Track order cancellation
     */
    fun orderCancelled(orderId: String, reason: String? = null) {
        val props = mutableMapOf<String, Any?>("order_id" to orderId)
        reason?.let { props["reason"] = it }
        sdk.track("Order Cancelled", props)
    }

    /**
     * Track order refund
     */
    fun orderRefunded(orderId: String, refundAmount: Double? = null, reason: String? = null) {
        val props = mutableMapOf<String, Any?>("order_id" to orderId)
        refundAmount?.let { props["refund_amount"] = it }
        reason?.let { props["reason"] = it }
        sdk.track("Order Refunded", props)
    }

    // MARK: - Wishlist Events

    /**
     * Track product added to wishlist
     */
    fun addToWishlist(product: EcommerceProduct) {
        val props = mutableMapOf<String, Any?>(
            "product_id" to product.productId,
            "name" to product.name,
            "price" to product.price,
            "currency" to config.currency
        )
        product.category?.let { props["category"] = it }
        product.brand?.let { props["brand"] = it }
        sdk.track("Product Added to Wishlist", props)
    }

    /**
     * Track product removed from wishlist
     */
    fun removeFromWishlist(product: EcommerceProduct) {
        sdk.track("Product Removed from Wishlist", mapOf(
            "product_id" to product.productId,
            "name" to product.name
        ))
    }

    // MARK: - Engagement Events

    /**
     * Track product shared
     */
    fun shareProduct(product: EcommerceProduct, shareMethod: String) {
        sdk.track("Product Shared", mapOf(
            "product_id" to product.productId,
            "name" to product.name,
            "share_method" to shareMethod
        ))
    }

    /**
     * Track coupon applied
     */
    fun applyCoupon(couponCode: String, discountAmount: Double? = null, discountType: String? = null) {
        val props = mutableMapOf<String, Any?>("coupon_code" to couponCode)
        discountAmount?.let { props["discount_amount"] = it }
        discountType?.let { props["discount_type"] = it }
        sdk.track("Coupon Applied", props)
    }

    /**
     * Track coupon removed
     */
    fun removeCoupon(couponCode: String) {
        sdk.track("Coupon Removed", mapOf("coupon_code" to couponCode))
    }

    /**
     * Track product review submitted
     */
    fun submitReview(productId: String, rating: Int, reviewText: String? = null) {
        val props = mutableMapOf<String, Any?>(
            "product_id" to productId,
            "rating" to rating
        )
        reviewText?.let { props["review_text"] = it }
        sdk.track("Product Reviewed", props)
    }

    companion object {
        /**
         * Create an e-commerce tracker with default configuration
         */
        @JvmStatic
        fun create(config: EcommerceConfig = EcommerceConfig()): EcommerceTracker {
            return EcommerceTracker(Joryio.getInstance(), config)
        }
    }
}

/**
 * Extension to get e-commerce tracker from Joryio instance
 */
fun Joryio.ecommerce(config: EcommerceConfig = EcommerceConfig()): EcommerceTracker {
    return EcommerceTracker(this, config)
}
