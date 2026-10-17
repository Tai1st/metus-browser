package com.metus.http.core

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

class PolicyAndCookieTest {
  private val policy = HttpPolicy()

  @Test fun hostAllowlist_matchesSubdomainsOnly() {
    assertTrue(policy.isHostAllowed("facebook.com"))
    assertTrue(policy.isHostAllowed("www.facebook.com"))
    assertTrue(policy.isHostAllowed("rupload-hkg4-2.up.facebook.com"))
    assertTrue(policy.isHostAllowed("scontent.fbmv1-1.fna.fbcdn.net"))
    assertFalse(policy.isHostAllowed("evilfacebook.com"))
    assertFalse(policy.isHostAllowed("facebook.com.evil.com"))
    assertFalse(HttpPolicy(allowedHosts = listOf("*")).isHostAllowed("anything.com"))
  }

  @Test fun privateAddresses() {
    listOf("127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1")
      .forEach { assertTrue(it, HttpPolicy.isPrivateAddress(InetAddress.getByName(it))) }
    listOf("157.240.1.35", "8.8.8.8", "2a03:2880:f10c:83:face:b00c::25de")
      .forEach { assertFalse(it, HttpPolicy.isPrivateAddress(InetAddress.getByName(it))) }
  }

  @Test fun ipLiteralParsing_doesNotResolveDns() {
    assertNull(HttpPolicy.parseIpLiteral("www.facebook.com"))
    assertTrue(HttpPolicy.parseIpLiteral("[::1]")!!.isLoopbackAddress)
  }

  @Test fun policyDns_rejectsHostsResolvingToPrivateIps() {
    val dns = PolicyDns({ HttpPolicy() }, fixedDns(InetAddress.getByName("127.0.0.1")))
    try {
      dns.lookup("rebind.facebook.com")
      throw AssertionError("phải chặn")
    } catch (e: java.net.UnknownHostException) {
      assertTrue(e.message!!.startsWith("ERR_BLOCKED_ADDRESS"))
    }
    val mixed = PolicyDns(
      { HttpPolicy() },
      fixedDns(InetAddress.getByName("10.0.0.1"), InetAddress.getByName("157.240.1.35")),
    )
    assertEquals(listOf(InetAddress.getByName("157.240.1.35")), mixed.lookup("x.facebook.com"))
  }

  private fun fixedDns(vararg addrs: InetAddress) = object : okhttp3.Dns {
    override fun lookup(hostname: String) = addrs.toList()
  }

  @Test fun cookieMatching_domainPathSecureExpiry() {
    var now = 1_000_000L
    val jar = AccountCookieJar("1", clock = { now })
    val fb = "https://www.facebook.com/".toHttpUrl()
    jar.saveFromResponse(
      fb,
      listOf(
        Cookie.parse(fb, "xs=secret; Domain=.facebook.com; Path=/; Secure")!!,
        Cookie.parse(fb, "only_api=1; Domain=.facebook.com; Path=/api")!!,
        Cookie.parse(fb, "host_only=1; Path=/")!!,
      ),
    )
    val names = { u: String -> jar.loadForRequest(u.toHttpUrl()).map { it.name }.toSet() }
    assertEquals(setOf("xs", "host_only"), names("https://www.facebook.com/"))
    assertEquals(setOf("xs", "only_api", "host_only"), names("https://www.facebook.com/api/graphql"))
    assertEquals(setOf("xs"), names("https://upload.facebook.com/"))
    assertEquals(emptySet<String>(), names("https://www.fbcdn.net/"))
    assertEquals(setOf("host_only"), names("http://www.facebook.com/")) // Secure không đi qua http
  }

  @Test fun cookieExpiry_removesCookies() {
    var now = 0L
    val jar = AccountCookieJar("1", clock = { now })
    val fb = "https://www.facebook.com/".toHttpUrl()
    jar.saveFromResponse(fb, listOf(Cookie.Builder().name("a").value("1").domain("facebook.com").expiresAt(1000).build()))
    assertEquals(1, jar.loadForRequest(fb).size)
    now = 2000
    assertTrue(jar.loadForRequest(fb).isEmpty())
  }

  @Test fun importAndSerialize_roundTrip() {
    val jar = AccountCookieJar("123")
    jar.importCookieHeader("c_user=123; xs=abc%3Adef; fr=zzz; i_user=999;", "facebook.com")
    val restored = AccountCookieJar.fromJson(jar.toJson())
    val url = "https://www.facebook.com/".toHttpUrl()
    assertEquals("123", restored.valueOf("c_user", url))
    assertEquals("999", restored.valueOf("i_user", url))
    assertEquals(jar.cookieHeaderFor(url), restored.cookieHeaderFor(url))
    assertTrue(restored.loadForRequest("https://www.instagram.com/".toHttpUrl()).isEmpty())
  }

  @Test fun parseCookieHeader_ignoresGarbage() {
    assertEquals(
      listOf("a" to "1", "b" to "x=y"),
      AccountCookieJar.parseCookieHeader(" a=1 ;; =bad; novalue=; b=x=y; junk"),
    )
  }
}
