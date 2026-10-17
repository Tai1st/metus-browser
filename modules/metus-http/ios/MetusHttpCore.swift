import Foundation

// MARK: - Errors

enum MetusErrorCode {
  static let badRequest = "ERR_METUS_BAD_REQUEST"
  static let blockedScheme = "ERR_METUS_BLOCKED_SCHEME"
  static let blockedHost = "ERR_METUS_BLOCKED_HOST"
  static let blockedAddress = "ERR_METUS_BLOCKED_ADDRESS"
  static let tooLarge = "ERR_METUS_TOO_LARGE"
  static let timeout = "ERR_METUS_TIMEOUT"
  static let cancelled = "ERR_METUS_CANCELLED"
  static let network = "ERR_METUS_NETWORK"
  static let tls = "ERR_METUS_TLS"
  static let queueFull = "ERR_METUS_QUEUE_FULL"
  static let tooManyRedirects = "ERR_METUS_TOO_MANY_REDIRECTS"
  static let noAccount = "ERR_METUS_NO_ACCOUNT"
  static let notLoggedIn = "ERR_METUS_NOT_LOGGED_IN"
  static let file = "ERR_METUS_FILE"
  static let unsupported = "ERR_METUS_UNSUPPORTED"
}

struct MetusHttpError: Error {
  let code: String
  let message: String
}

// MARK: - Policy

/// Xem HttpPolicy.kt — hai bản phải giữ cùng hành vi.
struct MetusHttpPolicy {
  var allowedHosts: [String] = ["facebook.com", "fbcdn.net", "fbsbx.com", "instagram.com", "tiktok.com", "metus.vn"]
  var allowHttp = false
  var blockPrivateNetworks = true
  var maxConcurrent = 6
  var maxQueued = 500
  var maxRequestBytes: Int64 = 512 * 1024 * 1024
  var maxResponseBytes: Int64 = 32 * 1024 * 1024
  var maxDownloadBytes: Int64 = 1024 * 1024 * 1024
  var maxRedirects = 10

  static func from(json: [String: Any]) -> MetusHttpPolicy {
    var p = MetusHttpPolicy()
    if let hosts = json["allowedHosts"] as? [String] { p.allowedHosts = hosts }
    if let v = json["allowHttp"] as? Bool { p.allowHttp = v }
    if let v = json["blockPrivateNetworks"] as? Bool { p.blockPrivateNetworks = v }
    if let v = json["maxConcurrent"] as? Int { p.maxConcurrent = min(max(v, 1), 32) }
    if let v = json["maxQueued"] as? Int { p.maxQueued = min(max(v, 1), 5000) }
    if let v = json["maxRequestBytes"] as? NSNumber { p.maxRequestBytes = v.int64Value }
    if let v = json["maxResponseBytes"] as? NSNumber { p.maxResponseBytes = v.int64Value }
    if let v = json["maxDownloadBytes"] as? NSNumber { p.maxDownloadBytes = v.int64Value }
    if let v = json["maxRedirects"] as? Int { p.maxRedirects = min(max(v, 0), 20) }
    return p
  }

  func isHostAllowed(_ host: String) -> Bool {
    let h = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
    return allowedHosts.contains { rule in
      let r = rule.lowercased().trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "."))
      return !r.isEmpty && r != "*" && (h == r || h.hasSuffix("." + r))
    }
  }

  func check(url: URL) throws {
    guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
      throw MetusHttpError(code: MetusErrorCode.blockedScheme, message: "Scheme không hỗ trợ")
    }
    if scheme == "http" && !allowHttp {
      throw MetusHttpError(code: MetusErrorCode.blockedScheme, message: "Chỉ cho phép HTTPS: \(url.host ?? "")")
    }
    guard let host = url.host, isHostAllowed(host) else {
      throw MetusHttpError(code: MetusErrorCode.blockedHost, message: "Host không nằm trong allowlist: \(url.host ?? "")")
    }
    if blockPrivateNetworks {
      if host == "localhost" || host.hasSuffix(".localhost") {
        throw MetusHttpError(code: MetusErrorCode.blockedAddress, message: "Địa chỉ nội bộ bị chặn: \(host)")
      }
      // Phân giải trước để chặn host trỏ về IP nội bộ. URLSession tự phân giải lại
      // nên vẫn còn cửa sổ DNS rebinding rất nhỏ — allowlist host là lớp chặn chính.
      for addr in MetusHttpPolicy.resolve(host) where MetusHttpPolicy.isPrivate(addr) {
        throw MetusHttpError(code: MetusErrorCode.blockedAddress, message: "Địa chỉ nội bộ bị chặn: \(host)")
      }
    }
  }

  /// Trả về các địa chỉ dạng byte (4 hoặc 16 byte).
  static func resolve(_ host: String) -> [[UInt8]] {
    var hints = addrinfo(ai_flags: 0, ai_family: AF_UNSPEC, ai_socktype: SOCK_STREAM, ai_protocol: 0,
                         ai_addrlen: 0, ai_canonname: nil, ai_addr: nil, ai_next: nil)
    var res: UnsafeMutablePointer<addrinfo>?
    guard getaddrinfo(host, nil, &hints, &res) == 0, let first = res else { return [] }
    defer { freeaddrinfo(first) }
    var out: [[UInt8]] = []
    var cur: UnsafeMutablePointer<addrinfo>? = first
    while let ai = cur {
      if ai.pointee.ai_family == AF_INET, let sa = ai.pointee.ai_addr {
        sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { p in
          var a = p.pointee.sin_addr
          out.append(withUnsafeBytes(of: &a) { Array($0) })
        }
      } else if ai.pointee.ai_family == AF_INET6, let sa = ai.pointee.ai_addr {
        sa.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { p in
          var a = p.pointee.sin6_addr
          out.append(withUnsafeBytes(of: &a) { Array($0) })
        }
      }
      cur = ai.pointee.ai_next
    }
    return out
  }

  static func isPrivate(_ b: [UInt8]) -> Bool {
    if b.count == 4 {
      let (o0, o1) = (b[0], b[1])
      return o0 == 0 || o0 == 10 || o0 == 127 ||
        (o0 == 169 && o1 == 254) ||
        (o0 == 172 && (16...31).contains(o1)) ||
        (o0 == 192 && o1 == 168) ||
        (o0 == 100 && (64...127).contains(o1)) ||
        (o0 == 192 && o1 == 0 && b[2] == 0) ||
        (o0 == 198 && (o1 == 18 || o1 == 19)) ||
        o0 >= 224
    }
    if b.count == 16 {
      if b[0..<15].allSatisfy({ $0 == 0 }) && (b[15] == 0 || b[15] == 1) { return true } // :: và ::1
      if (b[0] & 0xfe) == 0xfc { return true } // fc00::/7
      if b[0] == 0xfe && (b[1] & 0xc0) == 0x80 { return true } // fe80::/10
      if b[0] == 0xff { return true } // multicast
      if b[0..<10].allSatisfy({ $0 == 0 }) && b[10] == 0xff && b[11] == 0xff {
        return isPrivate(Array(b[12..<16]))
      }
    }
    return false
  }
}

// MARK: - Cookie jar

/// Cookie jar riêng cho 1 tài khoản. Xem AccountCookieJar.kt.
final class MetusCookieJar: @unchecked Sendable {
  let id: String
  private var cookies: [HTTPCookie] = []
  private let lock = NSLock()
  var onChanged: ((MetusCookieJar) -> Void)?

  init(id: String) { self.id = id }

  func save(from response: HTTPURLResponse, url: URL) {
    let fields = response.allHeaderFields.reduce(into: [String: String]()) { acc, kv in
      if let k = kv.key as? String, let v = kv.value as? String { acc[k] = v }
    }
    let parsed = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
    if parsed.isEmpty { return }
    lock.lock()
    parsed.forEach(putLocked)
    lock.unlock()
    onChanged?(self)
  }

  func cookies(for url: URL) -> [HTTPCookie] {
    lock.lock(); defer { lock.unlock() }
    pruneLocked()
    guard let host = url.host?.lowercased() else { return [] }
    let path = url.path.isEmpty ? "/" : url.path
    let https = url.scheme?.lowercased() == "https"
    return cookies.filter { c in
      let d = c.domain.lowercased()
      let domainOk = d.hasPrefix(".")
        ? (host == String(d.dropFirst()) || host.hasSuffix(d))
        : host == d
      let cp = c.path.isEmpty ? "/" : c.path
      let pathOk = path == cp || path.hasPrefix(cp.hasSuffix("/") ? cp : cp + "/")
      return domainOk && pathOk && (!c.isSecure || https)
    }
  }

  func header(for url: URL) -> String {
    cookies(for: url).map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
  }

  func value(_ name: String, for url: URL) -> String? {
    cookies(for: url).first { $0.name == name }?.value
  }

  var isEmpty: Bool {
    lock.lock(); defer { lock.unlock() }
    pruneLocked()
    return cookies.isEmpty
  }

  var count: Int {
    lock.lock(); defer { lock.unlock() }
    return Set(cookies.map(\.name)).count
  }

  func importHeader(_ header: String, domain: String) {
    let expires = Date().addingTimeInterval(365 * 24 * 3600)
    let parsed = MetusCookieJar.parseHeader(header).compactMap { name, value in
      HTTPCookie(properties: [
        .name: name, .value: value, .domain: "." + domain, .path: "/",
        .secure: "TRUE", .expires: expires,
      ])
    }
    lock.lock()
    parsed.forEach(putLocked)
    lock.unlock()
    onChanged?(self)
  }

  func toJSON() -> Data {
    lock.lock(); defer { lock.unlock() }
    pruneLocked()
    let list: [[String: Any]] = cookies.compactMap { c in
      guard let exp = c.expiresDate else { return nil } // không lưu session cookie
      return ["n": c.name, "v": c.value, "d": c.domain, "p": c.path,
              "e": exp.timeIntervalSince1970 * 1000, "s": c.isSecure, "h": c.isHTTPOnly]
    }
    return (try? JSONSerialization.data(withJSONObject: ["id": id, "cookies": list])) ?? Data()
  }

  static func from(json data: Data) -> MetusCookieJar? {
    guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = o["id"] as? String, let list = o["cookies"] as? [[String: Any]] else { return nil }
    let jar = MetusCookieJar(id: id)
    for c in list {
      guard let n = c["n"] as? String, let v = c["v"] as? String, let d = c["d"] as? String,
            let p = c["p"] as? String, let e = c["e"] as? Double else { continue }
      var props: [HTTPCookiePropertyKey: Any] = [.name: n, .value: v, .domain: d, .path: p,
                                                 .expires: Date(timeIntervalSince1970: e / 1000)]
      if c["s"] as? Bool == true { props[.secure] = "TRUE" }
      if c["h"] as? Bool == true { props[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
      if let cookie = HTTPCookie(properties: props) { jar.putLocked(cookie) }
    }
    return jar
  }

  static func parseHeader(_ header: String) -> [(String, String)] {
    header.split(separator: ";").compactMap { part in
      let s = part.trimmingCharacters(in: .whitespaces)
      guard let eq = s.firstIndex(of: "="), eq != s.startIndex else { return nil }
      let name = s[..<eq].trimmingCharacters(in: .whitespaces)
      let value = s[s.index(after: eq)...].trimmingCharacters(in: .whitespaces)
      return name.isEmpty || value.isEmpty ? nil : (name, value)
    }
  }

  private func putLocked(_ c: HTTPCookie) {
    cookies.removeAll { $0.name == c.name && $0.domain == c.domain && $0.path == c.path }
    if let exp = c.expiresDate, exp <= Date() { return }
    cookies.append(c)
  }

  private func pruneLocked() {
    let now = Date()
    cookies.removeAll { ($0.expiresDate.map { $0 <= now }) ?? false }
  }
}
