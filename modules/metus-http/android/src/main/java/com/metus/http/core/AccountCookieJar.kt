package com.metus.http.core

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cookie jar riêng cho 1 tài khoản. Cookie không bao giờ được trả về JS
 * trừ khi người dùng chủ động export (xem MetusHttpModule.exportCookieString).
 *
 * Việc khớp domain/path/Secure/hết hạn do okhttp3.Cookie.matches() đảm nhiệm.
 */
class AccountCookieJar(
  val id: String,
  private val clock: () -> Long = System::currentTimeMillis,
  private val onChanged: (AccountCookieJar) -> Unit = {},
) : CookieJar {
  private val cookies = mutableListOf<Cookie>()

  override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
    if (cookies.isEmpty()) return
    synchronized(this) { cookies.forEach(::putLocked) }
    onChanged(this)
  }

  override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(this) {
    pruneExpiredLocked()
    cookies.filter { it.matches(url) }
  }

  /** Nhập chuỗi "a=1; b=2" (định dạng header Cookie / export của trình duyệt). */
  fun importCookieHeader(header: String, domain: String) {
    val parsed = parseCookieHeader(header).map { (name, value) ->
      Cookie.Builder()
        .name(name)
        .value(value)
        .domain(domain)
        .path("/")
        .secure()
        // Không có thông tin hết hạn -> giữ 1 năm, Facebook sẽ ghi đè khi refresh.
        .expiresAt(clock() + ONE_YEAR_MS)
        .build()
    }
    synchronized(this) { parsed.forEach(::putLocked) }
    onChanged(this)
  }

  fun cookieHeaderFor(url: HttpUrl): String =
    loadForRequest(url).joinToString("; ") { "${it.name}=${it.value}" }

  fun valueOf(name: String, url: HttpUrl): String? =
    loadForRequest(url).firstOrNull { it.name == name }?.value

  fun cookieNames(): List<String> = synchronized(this) {
    pruneExpiredLocked()
    cookies.map { it.name }.distinct()
  }

  fun isEmpty(): Boolean = synchronized(this) {
    pruneExpiredLocked()
    cookies.isEmpty()
  }

  fun toJson(): String = synchronized(this) {
    pruneExpiredLocked()
    val arr = JSONArray()
    cookies.filter { it.persistent }.forEach { c ->
      arr.put(
        JSONObject()
          .put("n", c.name)
          .put("v", c.value)
          .put("d", c.domain)
          .put("p", c.path)
          .put("e", c.expiresAt)
          .put("s", c.secure)
          .put("h", c.httpOnly)
          .put("o", c.hostOnly),
      )
    }
    JSONObject().put("id", id).put("cookies", arr).toString()
  }

  private fun putLocked(c: Cookie) {
    cookies.removeAll { it.name == c.name && it.domain == c.domain && it.path == c.path }
    if (c.expiresAt > clock()) cookies.add(c)
  }

  private fun pruneExpiredLocked() {
    val now = clock()
    cookies.removeAll { it.expiresAt <= now }
  }

  companion object {
    private const val ONE_YEAR_MS = 365L * 24 * 3600 * 1000

    fun fromJson(
      json: String,
      clock: () -> Long = System::currentTimeMillis,
      onChanged: (AccountCookieJar) -> Unit = {},
    ): AccountCookieJar {
      val o = JSONObject(json)
      val jar = AccountCookieJar(o.getString("id"), clock, onChanged)
      val arr = o.getJSONArray("cookies")
      synchronized(jar) {
        for (i in 0 until arr.length()) {
          val c = arr.getJSONObject(i)
          val b = Cookie.Builder()
            .name(c.getString("n"))
            .value(c.getString("v"))
            .path(c.getString("p"))
            .expiresAt(c.getLong("e"))
          if (c.optBoolean("o")) b.hostOnlyDomain(c.getString("d")) else b.domain(c.getString("d"))
          if (c.optBoolean("s")) b.secure()
          if (c.optBoolean("h")) b.httpOnly()
          jar.putLocked(b.build())
        }
      }
      return jar
    }

    fun parseCookieHeader(header: String): List<Pair<String, String>> =
      header.split(';')
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .mapNotNull { part ->
          val eq = part.indexOf('=')
          if (eq <= 0) return@mapNotNull null
          val name = part.substring(0, eq).trim()
          val value = part.substring(eq + 1).trim()
          if (name.isEmpty() || value.isEmpty()) null else name to value
        }
  }
}
