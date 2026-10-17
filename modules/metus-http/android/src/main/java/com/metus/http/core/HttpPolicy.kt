package com.metus.http.core

import okhttp3.Dns
import okhttp3.HttpUrl
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException
import org.json.JSONObject

/**
 * Chính sách mạng áp dụng cho MỌI request đi qua engine.
 *
 * Native HTTP không bị CORS nên đây là lớp chặn duy nhất: host allowlist,
 * chặn địa chỉ nội bộ (SSRF), giới hạn kích thước và số request đồng thời.
 */
data class HttpPolicy(
  /** "facebook.com" khớp facebook.com và mọi subdomain. Không hỗ trợ "*". */
  val allowedHosts: List<String> = DEFAULT_ALLOWED_HOSTS,
  val allowHttp: Boolean = false,
  val blockPrivateNetworks: Boolean = true,
  val maxConcurrent: Int = 6,
  val maxQueued: Int = 500,
  val maxRequestBytes: Long = 512L * 1024 * 1024,
  val maxResponseBytes: Long = 32L * 1024 * 1024,
  val maxDownloadBytes: Long = 1024L * 1024 * 1024,
  val maxRedirects: Int = 10,
) {
  fun checkUrl(url: HttpUrl) {
    if (url.scheme == "http" && !allowHttp) {
      throw MetusHttpException(ErrorCode.BLOCKED_SCHEME, "Chỉ cho phép HTTPS: ${url.host}")
    }
    if (!isHostAllowed(url.host)) {
      throw MetusHttpException(ErrorCode.BLOCKED_HOST, "Host không nằm trong allowlist: ${url.host}")
    }
    if (blockPrivateNetworks) {
      val literal = parseIpLiteral(url.host)
      if (literal != null && isPrivateAddress(literal)) {
        throw MetusHttpException(ErrorCode.BLOCKED_ADDRESS, "Địa chỉ nội bộ bị chặn: ${url.host}")
      }
      if (url.host == "localhost" || url.host.endsWith(".localhost")) {
        throw MetusHttpException(ErrorCode.BLOCKED_ADDRESS, "Địa chỉ nội bộ bị chặn: ${url.host}")
      }
    }
  }

  fun isHostAllowed(host: String): Boolean {
    val h = host.lowercase().trimEnd('.')
    return allowedHosts.any { rule ->
      val r = rule.lowercase().trim().trimStart('.')
      r.isNotEmpty() && r != "*" && (h == r || h.endsWith(".$r"))
    }
  }

  companion object {
    val DEFAULT_ALLOWED_HOSTS = listOf(
      "facebook.com",
      "fbcdn.net",
      "fbsbx.com",
      "instagram.com",
      "tiktok.com",
      "metus.vn",
    )

    fun fromJson(json: JSONObject, base: HttpPolicy = HttpPolicy()): HttpPolicy {
      val hosts = json.optJSONArray("allowedHosts")?.let { arr ->
        (0 until arr.length()).map { arr.getString(it) }
      } ?: base.allowedHosts
      return base.copy(
        allowedHosts = hosts,
        allowHttp = json.optBoolean("allowHttp", base.allowHttp),
        blockPrivateNetworks = json.optBoolean("blockPrivateNetworks", base.blockPrivateNetworks),
        maxConcurrent = json.optInt("maxConcurrent", base.maxConcurrent).coerceIn(1, 32),
        maxQueued = json.optInt("maxQueued", base.maxQueued).coerceIn(1, 5000),
        maxRequestBytes = json.optLong("maxRequestBytes", base.maxRequestBytes),
        maxResponseBytes = json.optLong("maxResponseBytes", base.maxResponseBytes),
        maxDownloadBytes = json.optLong("maxDownloadBytes", base.maxDownloadBytes),
        maxRedirects = json.optInt("maxRedirects", base.maxRedirects).coerceIn(0, 20),
      )
    }

    /** Chỉ parse IP literal, KHÔNG phân giải DNS. */
    fun parseIpLiteral(host: String): InetAddress? {
      val h = host.removePrefix("[").removeSuffix("]")
      val isV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$").matches(h)
      val isV6 = h.contains(':') && Regex("^[0-9a-fA-F:.]+$").matches(h)
      if (!isV4 && !isV6) return null
      return try {
        InetAddress.getByName(h)
      } catch (_: Exception) {
        null
      }
    }

    fun isPrivateAddress(addr: InetAddress): Boolean {
      if (addr.isAnyLocalAddress || addr.isLoopbackAddress || addr.isLinkLocalAddress ||
        addr.isSiteLocalAddress || addr.isMulticastAddress
      ) return true
      val b = addr.address
      if (addr is Inet4Address) {
        val o0 = b[0].toInt() and 0xff
        val o1 = b[1].toInt() and 0xff
        return o0 == 0 || // 0.0.0.0/8
          (o0 == 100 && o1 in 64..127) || // CGNAT 100.64/10
          (o0 == 192 && o1 == 0 && (b[2].toInt() and 0xff) == 0) || // 192.0.0/24
          (o0 == 198 && (o1 == 18 || o1 == 19)) || // benchmark
          o0 >= 224 // multicast + reserved
      }
      if (addr is Inet6Address) {
        val first = b[0].toInt() and 0xff
        if ((first and 0xfe) == 0xfc) return true // fc00::/7 unique local
        // ::ffff:a.b.c.d (IPv4-mapped) -> kiểm tra phần IPv4
        val mapped = b.sliceArray(0 until 10).all { it.toInt() == 0 } &&
          (b[10].toInt() and 0xff) == 0xff && (b[11].toInt() and 0xff) == 0xff
        if (mapped) {
          return isPrivateAddress(InetAddress.getByAddress(b.sliceArray(12 until 16)))
        }
      }
      return false
    }
  }
}

/**
 * Dns kiểm tra địa chỉ SAU khi phân giải -> chống DNS rebinding trỏ host
 * hợp lệ về IP nội bộ.
 */
class PolicyDns(
  private val policyProvider: () -> HttpPolicy,
  private val delegate: Dns = Dns.SYSTEM,
) : Dns {
  override fun lookup(hostname: String): List<InetAddress> {
    val all = delegate.lookup(hostname)
    if (!policyProvider().blockPrivateNetworks) return all
    val safe = all.filterNot { HttpPolicy.isPrivateAddress(it) }
    if (safe.isEmpty()) {
      throw UnknownHostException("ERR_BLOCKED_ADDRESS: $hostname phân giải về địa chỉ nội bộ")
    }
    return safe
  }
}
