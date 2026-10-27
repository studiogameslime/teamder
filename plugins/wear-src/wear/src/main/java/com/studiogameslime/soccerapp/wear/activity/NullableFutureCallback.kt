package com.studiogameslime.soccerapp.wear.activity

import com.google.common.util.concurrent.FutureCallback

/** Guava succeeds with null for Void operations. Preserve that contract at the Kotlin boundary. */
internal class NullableFutureCallback<T>(
    private val succeeded: (T?) -> Unit,
    private val failed: (Throwable) -> Unit
) : FutureCallback<T> {
    override fun onSuccess(result: T?) = succeeded(result)
    override fun onFailure(error: Throwable) = failed(error)
}
