package com.metus.http.core

object ErrorCode {
  const val BAD_REQUEST = "ERR_METUS_BAD_REQUEST"
  const val BLOCKED_SCHEME = "ERR_METUS_BLOCKED_SCHEME"
  const val BLOCKED_HOST = "ERR_METUS_BLOCKED_HOST"
  const val BLOCKED_ADDRESS = "ERR_METUS_BLOCKED_ADDRESS"
  const val TOO_LARGE = "ERR_METUS_TOO_LARGE"
  const val TIMEOUT = "ERR_METUS_TIMEOUT"
  const val CANCELLED = "ERR_METUS_CANCELLED"
  const val NETWORK = "ERR_METUS_NETWORK"
  const val TLS = "ERR_METUS_TLS"
  const val QUEUE_FULL = "ERR_METUS_QUEUE_FULL"
  const val TOO_MANY_REDIRECTS = "ERR_METUS_TOO_MANY_REDIRECTS"
  const val NO_ACCOUNT = "ERR_METUS_NO_ACCOUNT"
  const val FILE = "ERR_METUS_FILE"
}

class MetusHttpException(val code: String, message: String, cause: Throwable? = null) :
  Exception(message, cause)
