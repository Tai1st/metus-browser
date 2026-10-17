import Foundation
import Network
import Security

// MARK: - Request spec (xem RequestSpec.kt)

struct MetusRequestSpec {
  let id: String
  let url: URL
  let method: String
  let headers: [(String, String)]
  let body: [String: Any]?
  let account: String?
  let timeoutMs: Double
  let followRedirects: Bool
  let responseType: String
  let downloadFileName: String?
  let proxy: [String: Any]?
  let retryCount: Int
  let retryBackoffMs: Double
  let retryNonIdempotent: Bool
  let reportProgress: Bool

  static let methods: Set<String> = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

  static func parse(_ json: String) throws -> MetusRequestSpec {
    func bad(_ m: String) -> MetusHttpError { MetusHttpError(code: MetusErrorCode.badRequest, message: m) }
    guard let data = json.data(using: .utf8),
          let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw bad("JSON không hợp lệ") }
    guard let id = o["id"] as? String, !id.isEmpty else { throw bad("Thiếu id") }
    guard let s = o["url"] as? String, let url = URL(string: s) else { throw bad("URL không hợp lệ") }
    let method = ((o["method"] as? String) ?? "GET").uppercased()
    guard methods.contains(method) else { throw bad("Method không hỗ trợ: \(method)") }
    let responseType = (o["responseType"] as? String) ?? "text"
    guard ["text", "base64", "file"].contains(responseType) else { throw bad("responseType không hỗ trợ") }
    let timeout = (o["timeoutMs"] as? NSNumber)?.doubleValue ?? 30_000
    guard timeout > 0 && timeout <= 30 * 60_000 else { throw bad("timeoutMs phải trong (0, 30 phút]") }
    var headers: [(String, String)] = []
    for pair in (o["headers"] as? [[String]]) ?? [] where pair.count == 2 {
      if pair[0].isEmpty || pair[0].contains(where: { $0 == ":" || $0 == " " || $0.isNewline }) { throw bad("Header không hợp lệ") }
      if pair[1].contains(where: \.isNewline) { throw bad("Header \(pair[0]) chứa ký tự xuống dòng") }
      headers.append((pair[0], pair[1]))
    }
    let retry = o["retry"] as? [String: Any]
    return MetusRequestSpec(
      id: id, url: url, method: method, headers: headers,
      body: o["body"] as? [String: Any],
      account: (o["account"] as? String).flatMap { $0.isEmpty ? nil : $0 },
      timeoutMs: timeout,
      followRedirects: (o["followRedirects"] as? Bool) ?? true,
      responseType: responseType,
      downloadFileName: o["downloadFileName"] as? String,
      proxy: o["proxy"] as? [String: Any],
      retryCount: min(max((retry?["count"] as? Int) ?? 0, 0), 5),
      retryBackoffMs: (retry?["backoffMs"] as? Double) ?? 500,
      retryNonIdempotent: (retry?["nonIdempotent"] as? Bool) ?? false,
      reportProgress: (o["reportProgress"] as? Bool) ?? false
    )
  }
}

// MARK: - Engine

/// Native HTTP engine dựa trên URLSession. Xem HttpEngine.kt — hai bản phải cùng hành vi.
final class MetusHttpEngine: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  static let shared = MetusHttpEngine()

  private let lock = NSLock()
  private var _policy = MetusHttpPolicy()
  private var tasks: [String: Task<String, Error>] = [:]
  private var inFlight = 0
  private var waiters: [CheckedContinuation<Void, Never>] = []
  var accounts: MetusAccountStore { MetusAccountStore.shared }
  var onProgress: ((String, Int64, Int64) -> Void)?

  var policy: MetusHttpPolicy {
    get { lock.lock(); defer { lock.unlock() }; return _policy }
    set { lock.lock(); _policy = newValue; lock.unlock() }
  }

  func run(_ spec: MetusRequestSpec) async throws -> String {
    lock.lock()
    if tasks.count >= _policy.maxQueued {
      lock.unlock()
      throw MetusHttpError(code: MetusErrorCode.queueFull, message: "Hàng đợi request đã đầy")
    }
    let task = Task<String, Error> { try await self.executeWithRetry(spec) }
    tasks[spec.id] = task
    lock.unlock()
    defer { lock.lock(); tasks[spec.id] = nil; lock.unlock() }
    do {
      return try await task.value
    } catch is CancellationError {
      throw MetusHttpError(code: MetusErrorCode.cancelled, message: "Request đã bị hủy")
    }
  }

  func cancel(_ id: String) {
    lock.lock(); let t = tasks[id]; lock.unlock()
    t?.cancel()
  }

  // Giới hạn số request chạy cùng lúc.
  private func acquire() async {
    let wait: Bool = { lock.lock(); defer { lock.unlock() }
      if inFlight < _policy.maxConcurrent { inFlight += 1; return false }
      return true
    }()
    if !wait { return }
    await withCheckedContinuation { c in
      lock.lock()
      if inFlight < _policy.maxConcurrent { inFlight += 1; lock.unlock(); c.resume() }
      else { waiters.append(c); lock.unlock() }
    }
  }

  private func release() {
    lock.lock()
    if !waiters.isEmpty { let c = waiters.removeFirst(); lock.unlock(); c.resume(); return }
    inFlight -= 1
    lock.unlock()
  }

  private func executeWithRetry(_ spec: MetusRequestSpec) async throws -> String {
    let idempotent: Set<String> = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]
    let canRetry = spec.retryCount > 0 && (spec.retryNonIdempotent || idempotent.contains(spec.method))
    var attempt = 0
    while true {
      do {
        await acquire()
        defer { release() }
        return try await executeOnce(spec)
      } catch let e as MetusHttpError where canRetry && attempt < spec.retryCount &&
        (e.code == MetusErrorCode.network || e.code == MetusErrorCode.timeout) {
        attempt += 1
        try await Task.sleep(nanoseconds: UInt64(spec.retryBackoffMs * Double(attempt) * 1_000_000))
      }
    }
  }

  private func makeSession(_ spec: MetusRequestSpec) throws -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = spec.timeoutMs / 1000
    config.timeoutIntervalForResource = spec.timeoutMs / 1000
    if let p = spec.proxy {
      guard #available(iOS 17.0, *) else {
        throw MetusHttpError(code: MetusErrorCode.unsupported, message: "Proxy cần iOS 17+")
      }
      guard let host = p["host"] as? String, let port = p["port"] as? Int,
            let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
        throw MetusHttpError(code: MetusErrorCode.badRequest, message: "Proxy không hợp lệ")
      }
      let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(host), port: nwPort)
      var proxy = (p["type"] as? String) == "socks"
        ? ProxyConfiguration(socksv5Proxy: endpoint)
        : ProxyConfiguration(httpCONNECTProxy: endpoint)
      if let u = p["username"] as? String {
        proxy.applyCredential(username: u, password: (p["password"] as? String) ?? "")
      }
      config.proxyConfigurations = [proxy]
    }
    // Delegate chặn redirect tự động (ta follow thủ công để kiểm tra policy).
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }

  private func executeOnce(_ spec: MetusRequestSpec) async throws -> String {
    let started = Date()
    let policy = self.policy
    var jar: MetusCookieJar?
    if let account = spec.account {
      guard let j = accounts.get(account) else {
        throw MetusHttpError(code: MetusErrorCode.noAccount, message: "Không tìm thấy tài khoản \(account)")
      }
      jar = j
    }
    let session = try makeSession(spec)
    defer { session.finishTasksAndInvalidate() }

    var url = spec.url
    var method = spec.method
    var headers = spec.headers.filter { name, _ in
      let l = name.lowercased()
      if ["accept-encoding", "content-length", "host"].contains(l) { return false }
      if l == "cookie" && spec.account != nil { return false }
      if l == "content-type" && (spec.body?["type"] as? String) == "multipart" { return false }
      return true
    }
    var bodyFile: URL? = try buildBody(spec, policy: policy, headers: &headers)
    defer { if let f = bodyFile, f.path.contains("metus-upload-") { try? FileManager.default.removeItem(at: f) } }
    var redirects = 0

    while true {
      try Task.checkCancellation()
      try policy.check(url: url)
      var req = URLRequest(url: url)
      req.httpMethod = method
      req.timeoutInterval = spec.timeoutMs / 1000
      for (k, v) in headers { req.addValue(v, forHTTPHeaderField: k) }
      if let jar = jar {
        let c = jar.header(for: url)
        if !c.isEmpty { req.setValue(c, forHTTPHeaderField: "Cookie") }
      }

      let (data, fileURL, response) = try await perform(session: session, request: req, bodyFile: method == "GET" || method == "HEAD" ? nil : bodyFile, spec: spec, policy: policy)
      jar?.save(from: response, url: url)

      if spec.followRedirects, [301, 302, 303, 307, 308].contains(response.statusCode),
         let loc = response.value(forHTTPHeaderField: "Location"), let next = URL(string: loc, relativeTo: url)?.absoluteURL {
        redirects += 1
        if redirects > policy.maxRedirects {
          throw MetusHttpError(code: MetusErrorCode.tooManyRedirects, message: "Quá \(policy.maxRedirects) lần redirect")
        }
        let code = response.statusCode
        if (code == 303 && method != "HEAD") || ((code == 301 || code == 302) && method == "POST") {
          method = "GET"
          bodyFile = nil
          headers.removeAll { ["content-type", "content-length"].contains($0.0.lowercased()) }
        }
        if next.host != url.host { headers.removeAll { $0.0.lowercased() == "authorization" } }
        url = next
        continue
      }

      var outHeaders: [[String]] = []
      for (k, v) in response.allHeaderFields {
        guard let k = k as? String, let v = v as? String else { continue }
        if spec.account != nil && k.lowercased() == "set-cookie" { continue }
        outHeaders.append([k, v])
      }
      let (bodyType, body): (String, String)
      if method == "HEAD" {
        (bodyType, body) = ("text", "")
      } else if let f = fileURL {
        (bodyType, body) = ("file", f.path)
      } else if spec.responseType == "base64" {
        (bodyType, body) = ("base64", data.base64EncodedString())
      } else {
        let enc = response.textEncodingName.map {
          String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringConvertIANACharSetNameToEncoding($0 as CFString)))
        } ?? .utf8
        (bodyType, body) = ("text", String(data: data, encoding: enc) ?? String(decoding: data, as: UTF8.self))
      }
      let result: [String: Any] = [
        "status": response.statusCode,
        "statusText": HTTPURLResponse.localizedString(forStatusCode: response.statusCode),
        "headers": outHeaders,
        "url": response.url?.absoluteString ?? url.absoluteString,
        "bodyType": bodyType,
        "body": body,
        "durationMs": Int(Date().timeIntervalSince(started) * 1000),
        "redirects": redirects,
      ]
      let json = try JSONSerialization.data(withJSONObject: result)
      return String(decoding: json, as: UTF8.self)
    }
  }

  private func perform(session: URLSession, request: URLRequest, bodyFile: URL?, spec: MetusRequestSpec, policy: MetusHttpPolicy)
    async throws -> (Data, URL?, HTTPURLResponse) {
    do {
      let delegate = spec.reportProgress ? ProgressDelegate(id: spec.id, onProgress: onProgress) : nil
      if spec.responseType == "file" {
        var req = request
        if let f = bodyFile { req.httpBodyStream = InputStream(url: f) }
        let (tmp, resp) = try await session.download(for: req, delegate: delegate)
        guard let http = resp as? HTTPURLResponse else { throw MetusHttpError(code: MetusErrorCode.network, message: "Phản hồi không hợp lệ") }
        let size = (try? FileManager.default.attributesOfItem(atPath: tmp.path)[.size] as? Int64) ?? 0
        if size > policy.maxDownloadBytes {
          try? FileManager.default.removeItem(at: tmp)
          throw MetusHttpError(code: MetusErrorCode.tooLarge, message: "File tải về vượt giới hạn")
        }
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("metus-downloads")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safe = (spec.downloadFileName ?? "download.bin").replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
        let dest = dir.appendingPathComponent("\(UUID().uuidString)-\(safe.prefix(80))")
        try FileManager.default.moveItem(at: tmp, to: dest)
        return (Data(), dest, http)
      }
      let (data, resp): (Data, URLResponse)
      if let f = bodyFile {
        (data, resp) = try await session.upload(for: request, fromFile: f, delegate: delegate)
      } else {
        (data, resp) = try await session.data(for: request, delegate: delegate)
      }
      guard let http = resp as? HTTPURLResponse else { throw MetusHttpError(code: MetusErrorCode.network, message: "Phản hồi không hợp lệ") }
      if Int64(data.count) > policy.maxResponseBytes {
        throw MetusHttpError(code: MetusErrorCode.tooLarge, message: "Response vượt giới hạn \(policy.maxResponseBytes) bytes")
      }
      return (data, nil, http)
    } catch let e as MetusHttpError {
      throw e
    } catch let e as URLError {
      switch e.code {
      case .cancelled: throw MetusHttpError(code: MetusErrorCode.cancelled, message: "Request đã bị hủy")
      case .timedOut: throw MetusHttpError(code: MetusErrorCode.timeout, message: "Hết thời gian chờ")
      case .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateNotYetValid,
           .serverCertificateHasUnknownRoot, .clientCertificateRejected, .secureConnectionFailed:
        throw MetusHttpError(code: MetusErrorCode.tls, message: "Lỗi TLS/chứng chỉ: \(e.localizedDescription)")
      default: throw MetusHttpError(code: MetusErrorCode.network, message: e.localizedDescription)
      }
    } catch is CancellationError {
      throw MetusHttpError(code: MetusErrorCode.cancelled, message: "Request đã bị hủy")
    }
  }

  // Ghi body ra file tạm để upload dạng stream (hỗ trợ video lớn).
  private func buildBody(_ spec: MetusRequestSpec, policy: MetusHttpPolicy, headers: inout [(String, String)]) throws -> URL? {
    guard let body = spec.body, let type = body["type"] as? String, type != "none" else { return nil }
    let explicitCT = headers.last { $0.0.lowercased() == "content-type" }?.1
    func setCT(_ ct: String?) {
      guard explicitCT == nil, let ct = ct else { return }
      headers.append(("Content-Type", ct))
    }
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("metus-upload-\(UUID().uuidString)")
    FileManager.default.createFile(atPath: tmp.path, contents: nil)
    let out = try FileHandle(forWritingTo: tmp)
    defer { try? out.close() }
    func write(_ s: String) { out.write(Data(s.utf8)) }

    switch type {
    case "text":
      write((body["text"] as? String) ?? "")
      setCT((body["contentType"] as? String) ?? "text/plain; charset=utf-8")
    case "base64":
      guard let d = Data(base64Encoded: (body["data"] as? String) ?? "") else {
        throw MetusHttpError(code: MetusErrorCode.badRequest, message: "base64 không hợp lệ")
      }
      out.write(d)
      setCT(body["contentType"] as? String)
    case "form":
      var allowed = CharacterSet.alphanumerics
      allowed.insert(charactersIn: "-._*")
      let fields = (body["fields"] as? [[String]]) ?? []
      write(fields.filter { $0.count == 2 }.map {
        ($0[0].addingPercentEncoding(withAllowedCharacters: allowed) ?? "") + "=" +
          ($0[1].addingPercentEncoding(withAllowedCharacters: allowed) ?? "")
      }.joined(separator: "&"))
      setCT("application/x-www-form-urlencoded")
    case "file":
      try copyFile(uri: (body["uri"] as? String) ?? "", to: out,
                   offset: (body["offset"] as? NSNumber)?.int64Value ?? 0,
                   length: (body["length"] as? NSNumber)?.int64Value)
      setCT(body["contentType"] as? String)
    case "multipart":
      let boundary = "MetusBoundary\(UUID().uuidString)"
      for part in (body["parts"] as? [[String: Any]]) ?? [] {
        let name = (part["name"] as? String) ?? ""
        write("--\(boundary)\r\n")
        if part["uri"] != nil || part["base64"] != nil {
          let fileName = (part["fileName"] as? String) ?? "file"
          write("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(fileName)\"\r\n")
          write("Content-Type: \((part["contentType"] as? String) ?? "application/octet-stream")\r\n\r\n")
          if let uri = part["uri"] as? String {
            try copyFile(uri: uri, to: out, offset: 0, length: nil)
          } else if let d = Data(base64Encoded: (part["base64"] as? String) ?? "") {
            out.write(d)
          }
        } else {
          write("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
          write((part["value"] as? String) ?? "")
        }
        write("\r\n")
      }
      write("--\(boundary)--\r\n")
      headers.removeAll { $0.0.lowercased() == "content-type" }
      headers.append(("Content-Type", "multipart/form-data; boundary=\(boundary)"))
    default:
      throw MetusHttpError(code: MetusErrorCode.badRequest, message: "Loại body không hỗ trợ: \(type)")
    }
    let size = (try? FileManager.default.attributesOfItem(atPath: tmp.path)[.size] as? Int64) ?? 0
    if size > policy.maxRequestBytes {
      throw MetusHttpError(code: MetusErrorCode.tooLarge, message: "Body request vượt giới hạn")
    }
    return tmp
  }

  /// Chỉ cho đọc file trong sandbox của app (tránh JS upload file tùy ý).
  private func copyFile(uri: String, to out: FileHandle, offset: Int64, length: Int64?) throws {
    guard let url = URL(string: uri), url.isFileURL else {
      throw MetusHttpError(code: MetusErrorCode.file, message: "Chỉ hỗ trợ file:// URI")
    }
    let path = url.standardizedFileURL.resolvingSymlinksInPath().path
    let roots = [NSTemporaryDirectory(),
                 FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].path,
                 FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].path]
      .map { URL(fileURLWithPath: $0).resolvingSymlinksInPath().path }
    guard roots.contains(where: { path.hasPrefix($0) }) else {
      throw MetusHttpError(code: MetusErrorCode.file, message: "Không được đọc file ngoài thư mục app")
    }
    guard let input = FileHandle(forReadingAtPath: path) else {
      throw MetusHttpError(code: MetusErrorCode.file, message: "Không mở được file")
    }
    defer { try? input.close() }
    try input.seek(toOffset: UInt64(offset))
    var remaining = length ?? Int64.max
    while remaining > 0 {
      let chunk = input.readData(ofLength: Int(min(remaining, 256 * 1024)))
      if chunk.isEmpty { break }
      out.write(chunk)
      remaining -= Int64(chunk.count)
    }
  }

  // MARK: URLSessionTaskDelegate

  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil) // follow thủ công
  }
}

private final class ProgressDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  let id: String
  let onProgress: ((String, Int64, Int64) -> Void)?
  private var last = Date.distantPast

  init(id: String, onProgress: ((String, Int64, Int64) -> Void)?) {
    self.id = id
    self.onProgress = onProgress
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                  totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    let now = Date()
    if now.timeIntervalSince(last) >= 0.2 || totalBytesSent == totalBytesExpectedToSend {
      last = now
      onProgress?(id, totalBytesSent, totalBytesExpectedToSend)
    }
  }
}

// MARK: - Account store (Keychain)

final class MetusAccountStore: @unchecked Sendable {
  static let shared = MetusAccountStore()
  private let service = "com.metus.http.accounts"
  private let lock = NSLock()
  private var jars: [String: MetusCookieJar] = [:]
  private var loaded = false

  private func loadIfNeeded() {
    if loaded { return }
    loaded = true
    let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitAll,
                            kSecReturnAttributes as String: true]
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let items = out as? [[String: Any]] else { return }
    for item in items {
      guard let data = item[kSecValueData as String] as? Data, let jar = MetusCookieJar.from(json: data) else { continue }
      jar.onChanged = { [weak self] in self?.persist($0) }
      jars[jar.id] = jar
    }
  }

  func get(_ id: String) -> MetusCookieJar? {
    lock.lock(); defer { lock.unlock() }
    loadIfNeeded()
    return jars[id]
  }

  func ids() -> [String] {
    lock.lock(); defer { lock.unlock() }
    loadIfNeeded()
    return jars.keys.sorted()
  }

  func replace(_ id: String) -> MetusCookieJar {
    lock.lock(); defer { lock.unlock() }
    loadIfNeeded()
    let jar = MetusCookieJar(id: id)
    jar.onChanged = { [weak self] in self?.persist($0) }
    jars[id] = jar
    return jar
  }

  func remove(_ id: String) {
    lock.lock()
    jars[id] = nil
    lock.unlock()
    SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                   kSecAttrAccount as String: id] as CFDictionary)
  }

  private func persist(_ jar: MetusCookieJar) {
    lock.lock(); let current = jars[jar.id] === jar; lock.unlock()
    guard current else { return }
    let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                               kSecAttrAccount as String: jar.id]
    let data = jar.toJSON()
    let attrs: [String: Any] = [kSecValueData as String: data,
                                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    if SecItemUpdate(base as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
      SecItemAdd(base.merging(attrs) { $1 } as CFDictionary, nil)
    }
  }
}
