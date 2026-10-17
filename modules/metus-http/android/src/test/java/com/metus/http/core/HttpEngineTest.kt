package com.metus.http.core

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.InputStream
import java.net.URI
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class HttpEngineTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var server: MockWebServer
  private var policy = HttpPolicy(
    allowedHosts = listOf("localhost"),
    allowHttp = true,
    blockPrivateNetworks = false,
  )
  private val jars = mutableMapOf<String, AccountCookieJar>()
  private lateinit var engine: HttpEngine

  private val files = object : FileAccess {
    override fun open(uri: String): InputStream = File(URI(uri)).inputStream()
    override fun size(uri: String): Long = File(URI(uri)).length()
    override fun createDownloadFile(name: String?): File = tmp.newFile()
  }

  private fun newEngine(client: OkHttpClient? = null) = HttpEngine(
    baseClient = client,
    policyProvider = { policy },
    jarProvider = { jars[it] },
    files = files,
    b64decode = { Base64.getDecoder().decode(it) },
    b64encode = { Base64.getEncoder().encodeToString(it) },
  )

  @Before fun setUp() {
    server = MockWebServer()
    server.start()
    engine = newEngine()
  }

  @After fun tearDown() {
    server.shutdown()
  }

  private var seq = 0

  /** Dùng "localhost" thay IP để khớp allowlist. */
  private fun url(path: String) = server.url(path).newBuilder().host("localhost").build().toString()

  private fun spec(path: String, extra: JSONObject.() -> Unit = {}): RequestSpec {
    val o = JSONObject().put("id", "r${seq++}").put("url", url(path))
    o.extra()
    return RequestSpec.parse(o)
  }

  private fun headers(vararg pairs: Pair<String, String>) =
    JSONArray().apply { pairs.forEach { put(JSONArray().put(it.first).put(it.second)) } }

  private fun expectError(code: String, block: () -> Unit) {
    try {
      block()
      fail("Mong đợi lỗi $code")
    } catch (e: MetusHttpException) {
      assertEquals(code, e.code)
    }
  }

  // ---------- Cơ bản ----------

  @Test fun getText_withoutCorsHeaders() {
    server.enqueue(MockResponse().setBody("xin chào").setHeader("Content-Type", "text/plain; charset=utf-8"))
    val res = engine.execute(spec("/hello"))
    assertEquals(200, res.status)
    assertEquals("xin chào", res.body)
    assertTrue(res.headers.none { it.first.equals("access-control-allow-origin", true) })
    assertEquals("GET", server.takeRequest().method)
  }

  @Test fun postJson() {
    server.enqueue(MockResponse().setBody("""{"ok":true}"""))
    val res = engine.execute(spec("/json") {
      put("method", "POST")
      put("headers", headers("Content-Type" to "application/json"))
      put("body", JSONObject().put("type", "text").put("text", """{"message":"Hello Metus"}"""))
    })
    assertEquals("""{"ok":true}""", res.body)
    val rec = server.takeRequest()
    assertEquals("POST", rec.method)
    assertTrue(rec.getHeader("Content-Type")!!.startsWith("application/json"))
    assertEquals("""{"message":"Hello Metus"}""", rec.body.readUtf8())
  }

  @Test fun customHeaders_originRefererAllowed() {
    server.enqueue(MockResponse())
    engine.execute(spec("/h") {
      put("headers", headers("Origin" to "https://www.facebook.com", "Referer" to "https://www.facebook.com/", "Sec-Fetch-Site" to "same-origin"))
    })
    val rec = server.takeRequest()
    assertEquals("https://www.facebook.com", rec.getHeader("Origin"))
    assertEquals("https://www.facebook.com/", rec.getHeader("Referer"))
    assertEquals("same-origin", rec.getHeader("Sec-Fetch-Site"))
  }

  @Test fun formUrlEncoded() {
    server.enqueue(MockResponse())
    engine.execute(spec("/form") {
      put("method", "POST")
      put("body", JSONObject().put("type", "form").put("fields", JSONArray().put(JSONArray().put("fb_dtsg").put("a b&c"))))
    })
    val rec = server.takeRequest()
    assertTrue(rec.getHeader("Content-Type")!!.startsWith("application/x-www-form-urlencoded"))
    assertEquals("fb_dtsg=a%20b%26c", rec.body.readUtf8())
  }

  @Test fun multipartUpload_withFile() {
    val f = tmp.newFile("video.mp4").apply { writeBytes(ByteArray(1000) { 7 }) }
    server.enqueue(MockResponse())
    engine.execute(spec("/upload") {
      put("method", "POST")
      put("headers", headers("Content-Type" to "multipart/form-data")) // phải bị bỏ để giữ boundary
      put("body", JSONObject().put("type", "multipart").put("parts", JSONArray()
        .put(JSONObject().put("name", "__user").put("value", "123"))
        .put(JSONObject().put("name", "file").put("uri", f.toURI().toString()).put("fileName", "video.mp4").put("contentType", "video/mp4"))))
    })
    val rec = server.takeRequest()
    val ct = rec.getHeader("Content-Type")!!
    assertTrue(ct.startsWith("multipart/form-data; boundary="))
    val body = rec.body.readByteArray()
    val text = String(body, Charsets.ISO_8859_1)
    assertTrue(text.contains("name=\"__user\""))
    assertTrue(text.contains("filename=\"video.mp4\""))
    assertTrue(body.size > 1000)
  }

  @Test fun fileBody_offsetAndLength() {
    val f = tmp.newFile("chunk.bin").apply { writeBytes(ByteArray(100) { it.toByte() }) }
    server.enqueue(MockResponse())
    engine.execute(spec("/rupload") {
      put("method", "POST")
      put("headers", headers("offset" to "10"))
      put("body", JSONObject().put("type", "file").put("uri", f.toURI().toString()).put("offset", 10).put("length", 20))
    })
    val rec = server.takeRequest()
    assertEquals("10", rec.getHeader("offset"))
    assertEquals((10 until 30).map { it.toByte() }, rec.body.readByteArray().toList())
  }

  @Test fun binaryDownload_base64() {
    val bytes = ByteArray(256) { it.toByte() }
    server.enqueue(MockResponse().setBody(Buffer().write(bytes)))
    val res = engine.execute(spec("/bin") { put("responseType", "base64") })
    assertEquals("base64", res.bodyType)
    assertEquals(bytes.toList(), Base64.getDecoder().decode(res.body).toList())
  }

  @Test fun binaryDownload_toFile() {
    server.enqueue(MockResponse().setBody(Buffer().write(ByteArray(5000) { 1 })))
    val res = engine.execute(spec("/file") { put("responseType", "file") })
    assertEquals("file", res.bodyType)
    assertEquals(5000L, File(res.body).length())
  }

  @Test fun httpErrorStatuses_areResponsesNotErrors() {
    for (code in listOf(400, 401, 500)) {
      server.enqueue(MockResponse().setResponseCode(code).setBody("e$code"))
      val res = engine.execute(spec("/s$code"))
      assertEquals(code, res.status)
      assertEquals("e$code", res.body)
    }
  }

  // ---------- Redirect ----------

  @Test fun redirect302_postBecomesGet() {
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/final"))
    server.enqueue(MockResponse().setBody("done"))
    val res = engine.execute(spec("/start") {
      put("method", "POST")
      put("body", JSONObject().put("type", "text").put("text", "x"))
    })
    assertEquals("done", res.body)
    assertEquals(1, res.redirects)
    assertTrue(res.url.endsWith("/final"))
    server.takeRequest()
    assertEquals("GET", server.takeRequest().method)
  }

  @Test fun redirect307_keepsMethodAndBody() {
    server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", "/again"))
    server.enqueue(MockResponse().setBody("ok"))
    engine.execute(spec("/start") {
      put("method", "POST")
      put("body", JSONObject().put("type", "text").put("text", "payload"))
    })
    server.takeRequest()
    val second = server.takeRequest()
    assertEquals("POST", second.method)
    assertEquals("payload", second.body.readUtf8())
  }

  @Test fun redirect_notFollowedWhenDisabled() {
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/x"))
    val res = engine.execute(spec("/r") { put("followRedirects", false) })
    assertEquals(302, res.status)
  }

  @Test fun redirect_toDisallowedHost_isBlocked() {
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://evil.example/steal"))
    expectError(ErrorCode.BLOCKED_HOST) { engine.execute(spec("/r")) }
  }

  @Test fun redirect_tooMany() {
    policy = policy.copy(maxRedirects = 2)
    repeat(3) { server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/loop")) }
    expectError(ErrorCode.TOO_MANY_REDIRECTS) { engine.execute(spec("/loop")) }
  }

  // ---------- Timeout / hủy / đồng thời ----------

  @Test fun timeout() {
    server.enqueue(MockResponse().setBody("late").setHeadersDelay(3, TimeUnit.SECONDS))
    expectError(ErrorCode.TIMEOUT) { engine.execute(spec("/slow") { put("timeoutMs", 300) }) }
  }

  @Test fun cancellation() {
    server.enqueue(MockResponse().setBody("late").setHeadersDelay(5, TimeUnit.SECONDS))
    val s = spec("/slow")
    val pool = Executors.newSingleThreadExecutor()
    val future = pool.submit<Any?> {
      try {
        engine.execute(s)
      } catch (e: MetusHttpException) {
        e.code
      }
    }
    Thread.sleep(300)
    engine.cancel(s.id)
    assertEquals(ErrorCode.CANCELLED, future.get(3, TimeUnit.SECONDS))
    pool.shutdown()
  }

  @Test fun concurrentRequests() {
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest) = MockResponse().setBody(request.path!!)
    }
    val n = 20
    val pool = Executors.newFixedThreadPool(8)
    val done = CountDownLatch(n)
    val results = java.util.concurrent.ConcurrentHashMap<String, String>()
    repeat(n) { i ->
      pool.execute {
        results["/c$i"] = engine.execute(spec("/c$i")).body
        done.countDown()
      }
    }
    assertTrue(done.await(10, TimeUnit.SECONDS))
    repeat(n) { assertEquals("/c$it", results["/c$it"]) }
    pool.shutdown()
  }

  @Test fun retry_onNetworkError_forIdempotent() {
    server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
    server.enqueue(MockResponse().setBody("second"))
    val res = engine.execute(spec("/flaky") { put("retry", JSONObject().put("count", 2).put("backoffMs", 10)) })
    assertEquals("second", res.body)
  }

  // ---------- Cookie ----------

  @Test fun cookieJar_storesAndSendsBack_andHidesSetCookie() {
    jars["100"] = AccountCookieJar("100")
    server.enqueue(MockResponse().addHeader("Set-Cookie", "sid=abc; Path=/"))
    server.enqueue(MockResponse())
    val first = engine.execute(spec("/login") { put("account", "100") })
    assertTrue(first.headers.none { it.first.equals("set-cookie", true) })
    engine.execute(spec("/me") { put("account", "100") })
    server.takeRequest()
    assertEquals("sid=abc", server.takeRequest().getHeader("Cookie"))
  }

  @Test fun credentialsOmit_sendsNoCookie() {
    jars["100"] = AccountCookieJar("100").apply { importCookieHeader("c_user=100; xs=secret", "localhost") }
    server.enqueue(MockResponse())
    engine.execute(spec("/omit"))
    assertNull(server.takeRequest().getHeader("Cookie"))
  }

  @Test fun account_manualCookieHeaderIsIgnored() {
    jars["100"] = AccountCookieJar("100").apply {
      saveFromResponse(url("/").toHttpUrl(), listOf(okhttp3.Cookie.parse(url("/").toHttpUrl(), "a=1")!!))
    }
    server.enqueue(MockResponse())
    engine.execute(spec("/x") {
      put("account", "100")
      put("headers", headers("Cookie" to "stolen=1"))
    })
    assertEquals("a=1", server.takeRequest().getHeader("Cookie"))
  }

  @Test fun unknownAccount_isRejected() {
    expectError(ErrorCode.NO_ACCOUNT) { engine.execute(spec("/x") { put("account", "999") }) }
  }

  // ---------- Bảo mật ----------

  @Test fun tls_untrustedCertificate_isRejected() {
    val cert = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
    val serverCerts = HandshakeCertificates.Builder().heldCertificate(cert).build()
    val tlsServer = MockWebServer()
    tlsServer.useHttps(serverCerts.sslSocketFactory(), false)
    tlsServer.enqueue(MockResponse().setBody("secret"))
    tlsServer.start()
    try {
      val u = tlsServer.url("/").newBuilder().host("localhost").build().toString()
      expectError(ErrorCode.TLS) {
        engine.execute(RequestSpec.parse(JSONObject().put("id", "tls").put("url", u)))
      }
    } finally {
      tlsServer.shutdown()
    }
  }

  @Test fun responseTooLarge() {
    policy = policy.copy(maxResponseBytes = 1000)
    server.enqueue(MockResponse().setBody(Buffer().write(ByteArray(5000))))
    expectError(ErrorCode.TOO_LARGE) { engine.execute(spec("/big")) }
  }

  @Test fun requestTooLarge() {
    policy = policy.copy(maxRequestBytes = 10)
    expectError(ErrorCode.TOO_LARGE) {
      engine.execute(spec("/up") {
        put("method", "POST")
        put("body", JSONObject().put("type", "text").put("text", "x".repeat(100)))
      })
    }
  }

  @Test fun disallowedHost_isBlocked_beforeAnyNetwork() {
    expectError(ErrorCode.BLOCKED_HOST) {
      engine.execute(RequestSpec.parse(JSONObject().put("id", "x").put("url", "https://example.com/")))
    }
    assertEquals(0, server.requestCount)
  }

  @Test fun privateAddress_isBlocked_whenPolicyOn() {
    policy = HttpPolicy(allowedHosts = listOf("localhost", "127.0.0.1"), allowHttp = true, blockPrivateNetworks = true)
    expectError(ErrorCode.BLOCKED_ADDRESS) { engine.execute(spec("/x")) }
    expectError(ErrorCode.BLOCKED_ADDRESS) {
      engine.execute(RequestSpec.parse(JSONObject().put("id", "ip").put("url", "http://127.0.0.1:${server.port}/")))
    }
    assertEquals(0, server.requestCount)
  }

  @Test fun plainHttp_isBlocked_byDefault() {
    policy = HttpPolicy(allowedHosts = listOf("localhost"), blockPrivateNetworks = false)
    expectError(ErrorCode.BLOCKED_SCHEME) { engine.execute(spec("/x")) }
  }

  @Test fun authorizationHeader_droppedOnCrossHostRedirect() {
    // Cùng server nhưng khác hostname (localhost -> 127.0.0.1) = khác host.
    policy = policy.copy(allowedHosts = listOf("localhost", "127.0.0.1"))
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "http://127.0.0.1:${server.port}/next"))
    server.enqueue(MockResponse())
    engine.execute(spec("/a") { put("headers", headers("Authorization" to "Bearer t")) })
    assertEquals("Bearer t", server.takeRequest().getHeader("Authorization"))
    assertNull(server.takeRequest().getHeader("Authorization"))
  }

  @Test fun badRequestSpec_rejected() {
    expectError(ErrorCode.BAD_REQUEST) { RequestSpec.parse("""{"id":"1","url":"https://facebook.com","method":"TRACE"}""") }
    expectError(ErrorCode.BAD_REQUEST) {
      RequestSpec.parse("""{"id":"1","url":"https://facebook.com","headers":[["X-A","a\r\nInjected: 1"]]}""")
    }
    assertFalse(policy.isHostAllowed("facebook.com.evil.com"))
  }
}
