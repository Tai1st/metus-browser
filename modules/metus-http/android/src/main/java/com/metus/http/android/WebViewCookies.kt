package com.metus.http.android

import android.webkit.CookieManager
import com.metus.http.core.AccountCookieJar

/**
 * Cầu nối với kho cookie của Android WebView (dùng cho màn đăng nhập Facebook).
 * CookieManager.getCookie() trả về cả cookie HttpOnly dưới dạng "a=1; b=2".
 */
object WebViewCookies {
  fun read(url: String): String = CookieManager.getInstance().getCookie(url) ?: ""

  fun clear(url: String, domain: String) {
    val cm = CookieManager.getInstance()
    AccountCookieJar.parseCookieHeader(read(url)).forEach { (name, _) ->
      val expired = "$name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"
      cm.setCookie(url, "$expired; Domain=.$domain")
      cm.setCookie(url, expired)
    }
    flush(cm)
  }

  fun write(url: String, domain: String, cookieHeader: String) {
    val cm = CookieManager.getInstance()
    cm.setAcceptCookie(true)
    AccountCookieJar.parseCookieHeader(cookieHeader).forEach { (name, value) ->
      cm.setCookie(url, "$name=$value; Domain=.$domain; Path=/; Secure; Max-Age=31536000")
    }
    flush(cm)
  }

  private fun flush(cm: CookieManager) = cm.flush()
}
