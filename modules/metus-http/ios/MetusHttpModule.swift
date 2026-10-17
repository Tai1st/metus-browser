import ExpoModulesCore
import WebKit

final class MetusException: Exception, @unchecked Sendable {
  private let c: String
  private let m: String

  init(_ code: String, _ message: String) {
    c = code
    m = message
    super.init()
  }

  override var code: String { c }
  override var reason: String { m }
}

private func wrap<T>(_ block: () async throws -> T) async throws -> T {
  do {
    return try await block()
  } catch let e as MetusHttpError {
    throw MetusException(e.code, e.message)
  }
}

public class MetusHttpModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MetusHttp")

    Events("onProgress")

    OnCreate {
      MetusHttpEngine.shared.onProgress = { [weak self] id, sent, total in
        self?.sendEvent("onProgress", ["id": id, "sent": Double(sent), "total": Double(total)])
      }
    }

    Function("configure") { (policyJson: String) in
      let obj = (try? JSONSerialization.jsonObject(with: Data(policyJson.utf8))) as? [String: Any] ?? [:]
      MetusHttpEngine.shared.policy = MetusHttpPolicy.from(json: obj)
    }

    AsyncFunction("request") { (specJson: String) async throws -> String in
      try await wrap {
        let spec = try MetusRequestSpec.parse(specJson)
        return try await MetusHttpEngine.shared.run(spec)
      }
    }

    Function("cancel") { (id: String) in
      MetusHttpEngine.shared.cancel(id)
    }

    // ---------- Tài khoản (cookie jar) ----------

    AsyncFunction("listAccounts") { () -> [[String: Any]] in
      let store = MetusAccountStore.shared
      return store.ids().compactMap { id in
        guard let jar = store.get(id) else { return nil }
        return ["id": id, "hasSession": !jar.isEmpty, "cookieCount": jar.count]
      }
    }

    AsyncFunction("importFromWebView") { (domain: String) async throws -> [String: Any?] in
      try await wrap {
        let d = try checkedDomain(domain)
        let header = await webViewCookies(domain: d).map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        return try saveAccount(header: header, domain: d)
      }
    }

    AsyncFunction("importCookieString") { (cookie: String, domain: String) async throws -> [String: Any?] in
      try await wrap { try saveAccount(header: cookie, domain: try checkedDomain(domain)) }
    }

    AsyncFunction("exportCookieString") { (id: String, domain: String) async throws -> String in
      try await wrap {
        let d = try checkedDomain(domain)
        return try requireJar(id).header(for: URL(string: "https://www.\(d)/")!)
      }
    }

    AsyncFunction("accountInfo") { (id: String) async throws -> [String: Any?] in
      try await wrap {
        let jar = try requireJar(id)
        let url = URL(string: "https://www.facebook.com/")!
        return ["id": id, "cUser": jar.value("c_user", for: url), "iUser": jar.value("i_user", for: url)]
      }
    }

    AsyncFunction("removeAccount") { (id: String) in
      MetusAccountStore.shared.remove(id)
    }

    AsyncFunction("clearWebViewCookies") { (domain: String) async throws in
      try await wrap {
        let d = try checkedDomain(domain)
        await clearWebView(domain: d)
      }
    }

    AsyncFunction("applyAccountToWebView") { (id: String, domain: String) async throws in
      try await wrap {
        let d = try checkedDomain(domain)
        let header = try requireJar(id).header(for: URL(string: "https://www.\(d)/")!)
        await clearWebView(domain: d)
        await setWebViewCookies(domain: d, header: header)
      }
    }
  }
}

private func checkedDomain(_ domain: String) throws -> String {
  let d = domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ". "))
  guard MetusHttpEngine.shared.policy.isHostAllowed(d) else {
    throw MetusHttpError(code: MetusErrorCode.blockedHost, message: "Domain không được phép: \(d)")
  }
  return d
}

private func requireJar(_ id: String) throws -> MetusCookieJar {
  guard let jar = MetusAccountStore.shared.get(id) else {
    throw MetusHttpError(code: MetusErrorCode.noAccount, message: "Không có tài khoản \(id)")
  }
  return jar
}

private func saveAccount(header: String, domain: String) throws -> [String: Any?] {
  let pairs = MetusCookieJar.parseHeader(header)
  guard let uid = pairs.first(where: { $0.0 == "c_user" })?.1, uid.allSatisfy(\.isNumber) else {
    throw MetusHttpError(code: MetusErrorCode.notLoggedIn, message: "Chưa đăng nhập (thiếu c_user)")
  }
  MetusAccountStore.shared.replace(uid).importHeader(header, domain: domain)
  return ["id": uid, "iUser": pairs.first(where: { $0.0 == "i_user" })?.1]
}

// react-native-webview dùng WKWebsiteDataStore.default() (khi không bật incognito).
@MainActor
private func webViewCookies(domain: String) async -> [HTTPCookie] {
  let all = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
  return all.filter { c in
    let d = c.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
    return d == domain || d.hasSuffix("." + domain)
  }
}

@MainActor
private func clearWebView(domain: String) async {
  let store = WKWebsiteDataStore.default().httpCookieStore
  for c in await webViewCookies(domain: domain) {
    await store.deleteCookie(c)
  }
}

@MainActor
private func setWebViewCookies(domain: String, header: String) async {
  let store = WKWebsiteDataStore.default().httpCookieStore
  let expires = Date().addingTimeInterval(365 * 24 * 3600)
  for (name, value) in MetusCookieJar.parseHeader(header) {
    guard let c = HTTPCookie(properties: [.name: name, .value: value, .domain: "." + domain, .path: "/",
                                          .secure: "TRUE", .expires: expires]) else { continue }
    await store.setCookie(c)
  }
}
