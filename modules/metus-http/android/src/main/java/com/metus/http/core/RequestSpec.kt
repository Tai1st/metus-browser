package com.metus.http.core

import org.json.JSONArray
import org.json.JSONObject

/** Body của request, đã chuẩn hóa từ JS (xem src/sdk/serialize.ts). */
sealed class BodySpec {
  object None : BodySpec()
  data class Text(val text: String, val contentType: String?) : BodySpec()
  data class Base64(val data: String, val contentType: String?) : BodySpec()
  data class Form(val fields: List<Pair<String, String>>) : BodySpec()
  data class Multipart(val parts: List<PartSpec>) : BodySpec()
  data class File(val uri: String, val contentType: String?, val offset: Long, val length: Long?) : BodySpec()
}

sealed class PartSpec {
  abstract val name: String
  data class Field(override val name: String, val value: String) : PartSpec()
  data class FilePart(
    override val name: String,
    val uri: String,
    val fileName: String,
    val contentType: String?,
  ) : PartSpec()
  data class Bytes(
    override val name: String,
    val base64: String,
    val fileName: String,
    val contentType: String?,
  ) : PartSpec()
}

data class ProxySpec(
  val type: String, // "http" | "socks"
  val host: String,
  val port: Int,
  val username: String?,
  val password: String?,
)

data class RetrySpec(val count: Int, val backoffMs: Long, val nonIdempotent: Boolean)

data class RequestSpec(
  val id: String,
  val url: String,
  val method: String,
  val headers: List<Pair<String, String>>,
  val body: BodySpec,
  /** Id tài khoản (cookie jar) — null = không gửi cookie nào (credentials "omit"). */
  val account: String?,
  val timeoutMs: Long,
  val followRedirects: Boolean,
  /** "text" | "base64" | "file" */
  val responseType: String,
  val downloadFileName: String?,
  val proxy: ProxySpec?,
  val retry: RetrySpec?,
  val reportProgress: Boolean,
) {
  companion object {
    private val METHODS = setOf("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
    private val RESPONSE_TYPES = setOf("text", "base64", "file")

    fun parse(json: String): RequestSpec = parse(JSONObject(json))

    fun parse(o: JSONObject): RequestSpec {
      val id = o.optString("id").ifEmpty { bad("Thiếu id") }
      val url = o.optString("url").ifEmpty { bad("Thiếu url") }
      val method = o.optString("method", "GET").uppercase()
      if (method !in METHODS) bad("Method không hỗ trợ: $method")
      val responseType = o.optString("responseType", "text")
      if (responseType !in RESPONSE_TYPES) bad("responseType không hỗ trợ: $responseType")
      val timeout = o.optLong("timeoutMs", 30_000L)
      if (timeout <= 0 || timeout > 30 * 60_000L) bad("timeoutMs phải trong (0, 30 phút]")

      return RequestSpec(
        id = id,
        url = url,
        method = method,
        headers = parseHeaders(o.optJSONArray("headers")),
        body = parseBody(o.optJSONObject("body")),
        account = o.optString("account").ifEmpty { null },
        timeoutMs = timeout,
        followRedirects = o.optBoolean("followRedirects", true),
        responseType = responseType,
        downloadFileName = o.optString("downloadFileName").ifEmpty { null },
        proxy = o.optJSONObject("proxy")?.let(::parseProxy),
        retry = o.optJSONObject("retry")?.let {
          RetrySpec(
            count = it.optInt("count", 0).coerceIn(0, 5),
            backoffMs = it.optLong("backoffMs", 500L).coerceIn(0, 60_000L),
            nonIdempotent = it.optBoolean("nonIdempotent", false),
          )
        },
        reportProgress = o.optBoolean("reportProgress", false),
      )
    }

    private fun parseHeaders(arr: JSONArray?): List<Pair<String, String>> {
      if (arr == null) return emptyList()
      return (0 until arr.length()).map {
        val pair = arr.getJSONArray(it)
        val name = pair.getString(0)
        val value = pair.getString(1)
        if (name.isBlank() || name.any { c -> c <= ' ' || c == ':' }) bad("Header không hợp lệ: $name")
        if (value.any { c -> c == '\r' || c == '\n' }) bad("Header $name chứa ký tự xuống dòng")
        name to value
      }
    }

    private fun parseBody(o: JSONObject?): BodySpec {
      if (o == null) return BodySpec.None
      val ct = o.optString("contentType").ifEmpty { null }
      return when (val type = o.optString("type", "none")) {
        "none" -> BodySpec.None
        "text" -> BodySpec.Text(o.getString("text"), ct)
        "base64" -> BodySpec.Base64(o.getString("data"), ct)
        "form" -> {
          val arr = o.getJSONArray("fields")
          BodySpec.Form((0 until arr.length()).map {
            val p = arr.getJSONArray(it)
            p.getString(0) to p.getString(1)
          })
        }
        "multipart" -> {
          val arr = o.getJSONArray("parts")
          BodySpec.Multipart((0 until arr.length()).map { parsePart(arr.getJSONObject(it)) })
        }
        "file" -> BodySpec.File(
          uri = o.getString("uri"),
          contentType = ct,
          offset = o.optLong("offset", 0L).also { if (it < 0) bad("offset âm") },
          length = if (o.has("length") && !o.isNull("length")) o.getLong("length") else null,
        )
        else -> bad("Loại body không hỗ trợ: $type")
      }
    }

    private fun parsePart(p: JSONObject): PartSpec {
      val name = p.getString("name")
      val ct = p.optString("contentType").ifEmpty { null }
      val fileName = p.optString("fileName").ifEmpty { "file" }
      return when {
        p.has("uri") -> PartSpec.FilePart(name, p.getString("uri"), fileName, ct)
        p.has("base64") -> PartSpec.Bytes(name, p.getString("base64"), fileName, ct)
        else -> PartSpec.Field(name, p.optString("value", ""))
      }
    }

    private fun parseProxy(p: JSONObject): ProxySpec {
      val type = p.optString("type", "http")
      if (type != "http" && type != "socks") bad("Proxy type không hỗ trợ: $type")
      val port = p.optInt("port", 0)
      if (port !in 1..65535) bad("Proxy port không hợp lệ")
      return ProxySpec(
        type = type,
        host = p.getString("host"),
        port = port,
        username = p.optString("username").ifEmpty { null },
        password = p.optString("password").ifEmpty { null },
      )
    }

    private fun bad(msg: String): Nothing = throw MetusHttpException(ErrorCode.BAD_REQUEST, msg)
  }
}
