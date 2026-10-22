package com.metus.http.core

import android.util.Base64 as AndroidBase64
import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.Credentials
import okhttp3.FormBody
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer
import okio.BufferedSink
import okio.ForwardingSink
import okio.buffer
import okio.source
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/** Truy cập file phụ thuộc nền tảng (content:// trên Android, File trong test). */
interface FileAccess {
  fun open(uri: String): InputStream
  /** Kích thước nếu biết, -1 nếu không. */
  fun size(uri: String): Long
  fun createDownloadFile(name: String?): File
}

/** Giải mã base64 — tách ra để test JVM không phụ thuộc android.util.Base64. */
fun interface Base64Decoder {
  fun decode(s: String): ByteArray
}

fun interface Base64Encoder {
  fun encode(b: ByteArray): String
}

data class ResponseResult(
  val status: Int,
  val statusText: String,
  val headers: List<Pair<String, String>>,
  val url: String,
  val bodyType: String,
  val body: String,
  val durationMs: Long,
  val redirects: Int,
) {
  fun toJson(): String {
    val h = org.json.JSONArray()
    headers.forEach { (k, v) -> h.put(org.json.JSONArray().put(k).put(v)) }
    return JSONObject()
      .put("status", status)
      .put("statusText", statusText)
      .put("headers", h)
      .put("url", url)
      .put("bodyType", bodyType)
      .put("body", body)
      .put("durationMs", durationMs)
      .put("redirects", redirects)
      .toString()
  }
}

/**
 * Native HTTP engine dựa trên OkHttp.
 *
 * - Không có CORS: request đi thẳng từ app, không qua trình duyệt.
 * - TLS luôn được kiểm tra (không có TrustManager tùy biến).
 * - Redirect được follow thủ công để kiểm tra policy ở từng bước.
 * - Hàm execute() chặn luồng; module gọi nó trên executor riêng.
 */
class HttpEngine(
  baseClient: OkHttpClient?,
  private val policyProvider: () -> HttpPolicy,
  private val jarProvider: (String) -> CookieJar?,
  private val files: FileAccess,
  private val b64decode: Base64Decoder = Base64Decoder { AndroidBase64.decode(it, AndroidBase64.DEFAULT) },
  private val b64encode: Base64Encoder = Base64Encoder { AndroidBase64.encodeToString(it, AndroidBase64.NO_WRAP) },
  private val onProgress: (id: String, sent: Long, total: Long) -> Unit = { _, _, _ -> },
) {
  private val client: OkHttpClient = (baseClient ?: OkHttpClient()).newBuilder()
    .followRedirects(false)
    .followSslRedirects(false)
    .dns(PolicyDns(policyProvider))
    .cookieJar(CookieJar.NO_COOKIES)
    .connectTimeout(20, TimeUnit.SECONDS)
    .build()

  private val calls = ConcurrentHashMap<String, Call>()
  private val cancelled = ConcurrentHashMap.newKeySet<String>()

  fun cancel(id: String) {
    cancelled.add(id)
    calls[id]?.cancel()
  }

  fun execute(spec: RequestSpec): ResponseResult {
    val started = System.nanoTime()
    val retry = spec.retry
    val canRetry = retry != null && retry.count > 0 &&
      (retry.nonIdempotent || spec.method in IDEMPOTENT)
    var attempt = 0
    try {
      while (true) {
        try {
          return executeOnce(spec, started)
        } catch (e: MetusHttpException) {
          val transient = e.code == ErrorCode.NETWORK || e.code == ErrorCode.TIMEOUT
          if (!canRetry || !transient || attempt >= retry!!.count || spec.id in cancelled) throw e
          attempt++
          Thread.sleep(retry.backoffMs * attempt)
        }
      }
    } finally {
      calls.remove(spec.id)
      cancelled.remove(spec.id)
    }
  }

  /**
   * Bọc jar của tài khoản để hành động dưới danh nghĩa Page: thay cookie i_user
   * bằng [pageId] cho request tới facebook.com, và không lưu i_user Facebook trả về
   * (để các request khác vẫn là tài khoản cá nhân).
   */
  private fun actingAs(base: CookieJar, pageId: String): CookieJar = object : CookieJar {
    override fun loadForRequest(url: HttpUrl): List<okhttp3.Cookie> {
      val list = base.loadForRequest(url).filter { it.name != "i_user" }
      if (url.host != "facebook.com" && !url.host.endsWith(".facebook.com")) return list
      return list + okhttp3.Cookie.Builder().name("i_user").value(pageId).domain(url.host).path("/").secure().build()
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<okhttp3.Cookie>) =
      base.saveFromResponse(url, cookies.filter { it.name != "i_user" })
  }

  private fun executeOnce(spec: RequestSpec, started: Long): ResponseResult {
    val policy = policyProvider()
    val accountJar: CookieJar = if (spec.account != null) {
      jarProvider(spec.account)
        ?: throw MetusHttpException(ErrorCode.NO_ACCOUNT, "Không tìm thấy tài khoản ${spec.account}")
    } else {
      CookieJar.NO_COOKIES
    }
    val jar: CookieJar = spec.iUser?.let { actingAs(accountJar, it) } ?: accountJar

    val callClient = client.newBuilder()
      .cookieJar(jar)
      .callTimeout(spec.timeoutMs, TimeUnit.MILLISECONDS)
      .readTimeout(spec.timeoutMs, TimeUnit.MILLISECONDS)
      .writeTimeout(spec.timeoutMs, TimeUnit.MILLISECONDS)
      .applyProxy(spec.proxy)
      .build()

    var url = spec.url.toHttpUrlOrNull()
      ?: throw MetusHttpException(ErrorCode.BAD_REQUEST, "URL không hợp lệ: ${spec.url}")
    var method = spec.method
    var body: RequestBody? = buildBody(spec, policy)
    var headers = buildHeaders(spec)
    var redirects = 0

    while (true) {
      policy.checkUrl(url)
      val request = Request.Builder()
        .url(url)
        .headers(headers)
        .method(method, if (method == "GET" || method == "HEAD") null else body ?: EMPTY_BODY.takeIf { method in BODY_REQUIRED })
        .build()

      val response = run(callClient, spec.id, request)
      if (spec.followRedirects && response.isRedirect) {
        val location = response.header("Location")
        val next = location?.let { url.resolve(it) }
        if (next == null) return readResponse(response, spec, policy, started, redirects)
        response.close()
        if (++redirects > policy.maxRedirects) {
          throw MetusHttpException(ErrorCode.TOO_MANY_REDIRECTS, "Quá ${policy.maxRedirects} lần redirect")
        }
        // Giống trình duyệt: 303 luôn -> GET; 301/302 với POST -> GET.
        val code = response.code
        if (code == 303 && method != "HEAD" || (code == 301 || code == 302) && method == "POST") {
          method = "GET"
          body = null
          headers = headers.newBuilder().removeAll("Content-Type").removeAll("Content-Length").build()
        }
        // Không mang Authorization sang host khác.
        if (next.host != url.host) headers = headers.newBuilder().removeAll("Authorization").build()
        url = next
        continue
      }
      return readResponse(response, spec, policy, started, redirects)
    }
  }

  private fun run(c: OkHttpClient, id: String, request: Request): Response {
    if (id in cancelled) throw MetusHttpException(ErrorCode.CANCELLED, "Request đã bị hủy")
    val call = c.newCall(request)
    calls[id] = call
    if (id in cancelled) call.cancel()
    try {
      return call.execute()
    } catch (e: IOException) {
      throw mapIoError(e, id)
    }
  }

  private fun mapIoError(e: IOException, id: String): MetusHttpException = when {
    id in cancelled -> MetusHttpException(ErrorCode.CANCELLED, "Request đã bị hủy", e)
    e is MetusIoException -> e.inner
    e is SocketTimeoutException || (e is InterruptedIOException && e.message == "timeout") ->
      MetusHttpException(ErrorCode.TIMEOUT, "Hết thời gian chờ", e)
    e is UnknownHostException && e.message?.startsWith("ERR_BLOCKED_ADDRESS") == true ->
      MetusHttpException(ErrorCode.BLOCKED_ADDRESS, e.message ?: "Địa chỉ nội bộ bị chặn", e)
    e is SSLException -> MetusHttpException(ErrorCode.TLS, "Lỗi TLS/chứng chỉ: ${e.message}", e)
    else -> MetusHttpException(ErrorCode.NETWORK, e.message ?: e.javaClass.simpleName, e)
  }

  private fun buildHeaders(spec: RequestSpec): Headers {
    val b = Headers.Builder()
    for ((name, value) in spec.headers) {
      val lower = name.lowercase()
      // Để OkHttp tự giải nén gzip; Content-Length do body quyết định.
      if (lower == "accept-encoding" || lower == "content-length" || lower == "host") continue
      // Khi dùng jar của tài khoản, cookie chỉ lấy từ jar — không cho ghi đè tay.
      if (lower == "cookie" && spec.account != null) continue
      if (lower == "content-type" && spec.body is BodySpec.Multipart) continue
      b.addUnsafeNonAscii(name, value)
    }
    return b.build()
  }

  private fun headerContentType(spec: RequestSpec): MediaType? =
    spec.headers.lastOrNull { it.first.equals("content-type", true) }?.second?.toMediaTypeOrNull()

  private fun buildBody(spec: RequestSpec, policy: HttpPolicy): RequestBody? {
    val explicit = headerContentType(spec)
    val body: RequestBody = when (val b = spec.body) {
      BodySpec.None -> return null
      is BodySpec.Text -> b.text.toRequestBody(explicit ?: b.contentType?.toMediaTypeOrNull() ?: TEXT_UTF8)
      is BodySpec.Base64 -> b64decode.decode(b.data)
        .toRequestBody(explicit ?: b.contentType?.toMediaTypeOrNull())
      is BodySpec.Form -> FormBody.Builder().apply { b.fields.forEach { (k, v) -> add(k, v) } }.build()
      is BodySpec.File -> FileRequestBody(files, b.uri, explicit ?: b.contentType?.toMediaTypeOrNull(), b.offset, b.length)
      is BodySpec.Multipart -> MultipartBody.Builder().setType(MultipartBody.FORM).apply {
        b.parts.forEach { p ->
          when (p) {
            is PartSpec.Field -> addFormDataPart(p.name, p.value)
            is PartSpec.FilePart -> addFormDataPart(
              p.name, p.fileName,
              FileRequestBody(files, p.uri, p.contentType?.toMediaTypeOrNull(), 0, null),
            )
            is PartSpec.Bytes -> addFormDataPart(
              p.name, p.fileName,
              b64decode.decode(p.base64).toRequestBody(p.contentType?.toMediaTypeOrNull()),
            )
          }
        }
      }.build()
    }
    val len = body.contentLength()
    if (len > policy.maxRequestBytes) {
      throw MetusHttpException(ErrorCode.TOO_LARGE, "Body request vượt giới hạn ${policy.maxRequestBytes} bytes")
    }
    return if (spec.reportProgress) ProgressRequestBody(body) { sent, total -> onProgress(spec.id, sent, total) } else body
  }

  private fun readResponse(
    response: Response,
    spec: RequestSpec,
    policy: HttpPolicy,
    started: Long,
    redirects: Int,
  ): ResponseResult = response.use { res ->
    val headers = res.headers
      // Set-Cookie của tài khoản chỉ đi vào jar, không lộ ra JS.
      .filter { !(spec.account != null && it.first.equals("set-cookie", true)) }
    val body = res.body
    val (bodyType, content) = try {
      when {
        body == null || spec.method == "HEAD" -> "text" to ""
        spec.responseType == "file" -> {
          val file = files.createDownloadFile(spec.downloadFileName)
          copyLimited(body.byteStream(), file, policy.maxDownloadBytes)
          "file" to file.absolutePath
        }
        else -> {
          val bytes = readLimited(body.byteStream(), policy.maxResponseBytes)
          if (spec.responseType == "base64") {
            "base64" to b64encode.encode(bytes)
          } else {
            val charset = body.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8
            "text" to String(bytes, charset)
          }
        }
      }
    } catch (e: IOException) {
      throw mapIoError(e, spec.id)
    }
    ResponseResult(
      status = res.code,
      statusText = res.message,
      headers = headers.toList(),
      url = res.request.url.toString(),
      bodyType = bodyType,
      body = content,
      durationMs = (System.nanoTime() - started) / 1_000_000,
      redirects = redirects,
    )
  }

  private fun readLimited(input: InputStream, max: Long): ByteArray {
    val buf = Buffer()
    val src = input.source()
    while (true) {
      val n = src.read(buf, 64 * 1024)
      if (n == -1L) break
      if (buf.size > max) throw MetusHttpException(ErrorCode.TOO_LARGE, "Response vượt giới hạn $max bytes")
    }
    return buf.readByteArray()
  }

  private fun copyLimited(input: InputStream, file: File, max: Long) {
    var total = 0L
    file.outputStream().use { out ->
      val chunk = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(chunk)
        if (n == -1) break
        total += n
        if (total > max) {
          out.close()
          file.delete()
          throw MetusHttpException(ErrorCode.TOO_LARGE, "File tải về vượt giới hạn $max bytes")
        }
        out.write(chunk, 0, n)
      }
    }
  }

  private fun OkHttpClient.Builder.applyProxy(p: ProxySpec?): OkHttpClient.Builder {
    if (p == null) return this
    val type = if (p.type == "socks") Proxy.Type.SOCKS else Proxy.Type.HTTP
    proxy(Proxy(type, InetSocketAddress.createUnresolved(p.host, p.port)))
    if (type == Proxy.Type.HTTP && p.username != null) {
      val credential = Credentials.basic(p.username, p.password ?: "")
      proxyAuthenticator(Authenticator { _, response ->
        if (response.request.header("Proxy-Authorization") != null) null
        else response.request.newBuilder().header("Proxy-Authorization", credential).build()
      })
    }
    return this
  }

  companion object {
    private val IDEMPOTENT = setOf("GET", "HEAD", "OPTIONS", "PUT", "DELETE")
    private val BODY_REQUIRED = setOf("POST", "PUT", "PATCH")
    private val TEXT_UTF8 = "text/plain; charset=utf-8".toMediaTypeOrNull()
    private val EMPTY_BODY = ByteArray(0).toRequestBody(null)
  }
}

/** Bọc MetusHttpException để đi qua được các API chỉ cho phép IOException. */
class MetusIoException(val inner: MetusHttpException) : IOException(inner.message, inner)

/** Body đọc stream từ file/content URI; đọc lại được (mỗi lần writeTo mở stream mới). */
class FileRequestBody(
  private val files: FileAccess,
  private val uri: String,
  private val type: MediaType?,
  private val offset: Long,
  private val length: Long?,
) : RequestBody() {
  override fun contentType() = type

  override fun contentLength(): Long {
    if (length != null) return length
    val size = try {
      files.size(uri)
    } catch (e: Exception) {
      throw MetusHttpException(ErrorCode.FILE, "Không đọc được file: $uri", e)
    }
    return if (size < 0) -1 else (size - offset).coerceAtLeast(0)
  }

  override fun writeTo(sink: BufferedSink) {
    val input = try {
      files.open(uri)
    } catch (e: Exception) {
      throw MetusIoException(MetusHttpException(ErrorCode.FILE, "Không mở được file: $uri", e))
    }
    input.use { stream ->
      var toSkip = offset
      while (toSkip > 0) {
        val skipped = stream.skip(toSkip)
        if (skipped <= 0) throw MetusIoException(MetusHttpException(ErrorCode.FILE, "offset vượt kích thước file"))
        toSkip -= skipped
      }
      val src = stream.source()
      if (length == null) {
        sink.writeAll(src)
      } else {
        sink.write(src, length)
      }
    }
  }
}

/** Phát sự kiện tiến độ upload, tối đa ~5 lần/giây. */
class ProgressRequestBody(
  private val delegate: RequestBody,
  private val listener: (sent: Long, total: Long) -> Unit,
) : RequestBody() {
  override fun contentType() = delegate.contentType()
  override fun contentLength() = delegate.contentLength()
  override fun isOneShot() = delegate.isOneShot()

  override fun writeTo(sink: BufferedSink) {
    val total = contentLength()
    var sent = 0L
    var lastEmit = 0L
    val counting = object : ForwardingSink(sink) {
      override fun write(source: Buffer, byteCount: Long) {
        super.write(source, byteCount)
        sent += byteCount
        val now = System.currentTimeMillis()
        if (now - lastEmit >= 200 || sent == total) {
          lastEmit = now
          listener(sent, total)
        }
      }
    }.buffer()
    delegate.writeTo(counting)
    counting.flush()
  }
}
