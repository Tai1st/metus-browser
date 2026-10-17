package com.metus.http

import android.content.Context
import com.metus.http.android.AccountStore
import com.metus.http.android.AndroidFileAccess
import com.metus.http.android.WebViewCookies
import com.metus.http.core.AccountCookieJar
import com.metus.http.core.ErrorCode
import com.metus.http.core.HttpEngine
import com.metus.http.core.HttpPolicy
import com.metus.http.core.MetusHttpException
import com.metus.http.core.RequestSpec
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

class MetusHttpModule : Module() {
  @Volatile private var policy = HttpPolicy()
  @Volatile private var executor = newExecutor(policy)
  private var engine: HttpEngine? = null
  private var accounts: AccountStore? = null

  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_METUS_NO_CONTEXT", "React context chưa sẵn sàng", null)

  private fun store(): AccountStore = accounts ?: synchronized(this) {
    accounts ?: AccountStore(context).also { accounts = it }
  }

  private fun engine(): HttpEngine = engine ?: synchronized(this) {
    engine ?: HttpEngine(
      baseClient = null,
      policyProvider = { policy },
      jarProvider = { id -> store().get(id) },
      files = AndroidFileAccess(context),
      onProgress = { id, sent, total ->
        sendEvent("onProgress", mapOf("id" to id, "sent" to sent.toDouble(), "total" to total.toDouble()))
      },
    ).also { engine = it }
  }

  override fun definition() = ModuleDefinition {
    Name("MetusHttp")

    Events("onProgress")

    OnDestroy {
      executor.shutdownNow()
    }

    Function("configure") { policyJson: String ->
      val next = HttpPolicy.fromJson(JSONObject(policyJson))
      val old = executor
      policy = next
      executor = newExecutor(next)
      old.shutdown() // request đang chạy vẫn hoàn tất
    }

    AsyncFunction("request") { specJson: String, promise: Promise ->
      val spec = try {
        RequestSpec.parse(specJson)
      } catch (e: MetusHttpException) {
        promise.reject(e.code, e.message, e)
        return@AsyncFunction
      } catch (e: Exception) {
        promise.reject(ErrorCode.BAD_REQUEST, "Request không hợp lệ: ${e.message}", e)
        return@AsyncFunction
      }
      try {
        executor.execute {
          try {
            promise.resolve(engine().execute(spec).toJson())
          } catch (e: MetusHttpException) {
            promise.reject(e.code, e.message, e)
          } catch (e: Exception) {
            promise.reject(ErrorCode.NETWORK, e.message ?: e.javaClass.simpleName, e)
          }
        }
      } catch (e: RejectedExecutionException) {
        promise.reject(ErrorCode.QUEUE_FULL, "Hàng đợi request đã đầy", e)
      }
    }

    Function("cancel") { id: String ->
      engine?.cancel(id)
    }

    // ---------- Tài khoản (cookie jar) ----------

    AsyncFunction("listAccounts") {
      val s = store()
      s.ids().mapNotNull { id ->
        val jar = s.get(id) ?: return@mapNotNull null
        mapOf("id" to id, "hasSession" to !jar.isEmpty(), "cookieCount" to jar.cookieNames().size)
      }
    }

    /** Đọc cookie từ WebView đăng nhập -> tạo/ghi đè jar của tài khoản (id = c_user). */
    AsyncFunction("importFromWebView") { domain: String ->
      val d = checkedDomain(domain)
      saveAccountFromHeader(WebViewCookies.read("https://www.$d"), d)
    }

    AsyncFunction("importCookieString") { cookie: String, domain: String ->
      saveAccountFromHeader(cookie, checkedDomain(domain))
    }

    /** Chỉ gọi khi người dùng chủ động bấm "Sao chép cookie". */
    AsyncFunction("exportCookieString") { id: String, domain: String ->
      requireJar(id).cookieHeaderFor("https://www.${checkedDomain(domain)}/".toHttpUrl())
    }

    /** Chỉ trả các id công khai (c_user/i_user), KHÔNG trả cookie bí mật. */
    AsyncFunction("accountInfo") { id: String ->
      val jar = requireJar(id)
      val url = "https://www.facebook.com/".toHttpUrl()
      mapOf("id" to id, "cUser" to jar.valueOf("c_user", url), "iUser" to jar.valueOf("i_user", url))
    }

    AsyncFunction("removeAccount") { id: String ->
      store().remove(id)
    }

    AsyncFunction("clearWebViewCookies") { domain: String ->
      val d = checkedDomain(domain)
      WebViewCookies.clear("https://www.$d", d)
    }

    /** Đưa cookie của tài khoản vào WebView để duyệt web bằng tài khoản đó. */
    AsyncFunction("applyAccountToWebView") { id: String, domain: String ->
      val d = checkedDomain(domain)
      val header = requireJar(id).cookieHeaderFor("https://www.$d/".toHttpUrl())
      WebViewCookies.clear("https://www.$d", d)
      WebViewCookies.write("https://www.$d", d, header)
    }
  }

  private fun requireJar(id: String) =
    store().get(id) ?: throw CodedException(ErrorCode.NO_ACCOUNT, "Không có tài khoản $id", null)

  private fun checkedDomain(domain: String): String {
    val d = domain.lowercase().trim().trimStart('.')
    if (!policy.isHostAllowed(d)) throw CodedException(ErrorCode.BLOCKED_HOST, "Domain không được phép: $d", null)
    return d
  }

  private fun saveAccountFromHeader(header: String, domain: String): Map<String, Any?> {
    val pairs = AccountCookieJar.parseCookieHeader(header)
    val uid = pairs.firstOrNull { it.first == "c_user" }?.second
      ?: throw CodedException("ERR_METUS_NOT_LOGGED_IN", "Chưa đăng nhập (thiếu c_user)", null)
    if (!uid.all(Char::isDigit)) throw CodedException("ERR_METUS_NOT_LOGGED_IN", "c_user không hợp lệ", null)
    store().replace(uid).importCookieHeader(header, domain)
    return mapOf("id" to uid, "iUser" to pairs.firstOrNull { it.first == "i_user" }?.second)
  }

  private fun newExecutor(p: HttpPolicy) = ThreadPoolExecutor(
    p.maxConcurrent, p.maxConcurrent, 30, TimeUnit.SECONDS,
    LinkedBlockingQueue(p.maxQueued),
  ).apply { allowCoreThreadTimeOut(true) }
}
