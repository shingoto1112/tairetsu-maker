import Foundation
import SQLite3

public struct RepositoryError: Error {
    public let code: String
    public var retryable: Bool { ["BUSY", "IO_ERROR", "DEVICE_LOCKED"].contains(code) }
    public init(_ code: String) { self.code = code }

    // A protection probe is injected by the bridge; core does not import UIKit.
    public static func sqlite(_ result: Int32, systemErrno: Int32 = 0, protectedDataAvailable: Bool = true) -> RepositoryError {
        let primary = result & 0xff
        if primary == SQLITE_CORRUPT || primary == SQLITE_NOTADB { return RepositoryError("CORRUPT") }
        if primary == SQLITE_BUSY || primary == SQLITE_LOCKED { return RepositoryError("BUSY") }
        if primary == SQLITE_FULL || systemErrno == 28 { return RepositoryError("NO_SPACE") }
        let denied = [SQLITE_CANTOPEN, SQLITE_PERM, SQLITE_AUTH, SQLITE_READONLY].contains(primary) || [1, 13].contains(systemErrno)
        if !protectedDataAvailable && denied {
            return RepositoryError("DEVICE_LOCKED")
        }
        if denied {
            return RepositoryError("ACCESS_DENIED")
        }
        return RepositoryError("IO_ERROR")
    }

    public static func classify(_ error: Error, protectedDataAvailable: Bool = true) -> RepositoryError {
        if let error = error as? RepositoryError { return error }
        let e = error as NSError
        if e.domain == NSPOSIXErrorDomain {
            return sqlite(SQLITE_IOERR, systemErrno: Int32(e.code), protectedDataAvailable: protectedDataAvailable)
        }
        if e.domain == NSCocoaErrorDomain {
            if e.code == NSFileWriteOutOfSpaceError { return RepositoryError("NO_SPACE") }
            if [NSFileReadNoPermissionError, NSFileWriteNoPermissionError].contains(e.code) {
                return RepositoryError(protectedDataAvailable ? "ACCESS_DENIED" : "DEVICE_LOCKED")
            }
        }
        return RepositoryError("IO_ERROR")
    }
}

public enum RepositoryValidation {
    public static func validID(_ value: Any?) -> Bool {
        guard let s = value as? String, !s.isEmpty, s.utf8.count <= 255, !s.contains("..") else { return false }
        return !s.unicodeScalars.contains { c in
            c.value <= 31 || (127...159).contains(c.value) || [47, 92, 58].contains(c.value)
        }
    }
    static func id(_ value: Any?) throws -> String {
        guard validID(value), let s = value as? String else { throw RepositoryError("INVALID_ID") }
        return s
    }
    static func revision(_ value: Any?) throws -> String {
        guard let s = value as? String, !s.isEmpty,
              s.utf8.allSatisfy({ (48...57).contains($0) }), s == "0" || s.first != "0" else {
            throw RepositoryError("INVALID_ARGUMENT")
        }
        return s
    }
    static func greater(_ a: String, _ b: String) -> Bool { a.count == b.count ? a > b : a.count > b.count }
    static func integer(_ value: Any?) -> Int? {
        guard let n = value as? NSNumber, String(cString: n.objCType) != "c", n.doubleValue.isFinite,
              n.doubleValue == Double(n.intValue) else { return nil }
        return n.intValue
    }
    static func increment(_ value: String) -> String {
        var bytes = Array(value.utf8)
        for i in bytes.indices.reversed() {
            if bytes[i] != 57 { bytes[i] += 1; return String(decoding: bytes, as: UTF8.self) }
            bytes[i] = 48
        }
        return "1" + String(decoding: bytes, as: UTF8.self)
    }
    static func object(_ json: String, code: String = "INVALID_ARGUMENT") throws -> [String: Any] {
        do {
            guard !json.contains("\\u") || !hasUnpairedSurrogateEscape(json) else { throw RepositoryError(code) }
            guard let obj = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { throw RepositoryError(code) }
            return obj
        } catch { throw RepositoryError(code) }
    }
    // Foundation's handling of lone escaped surrogates varies by implementation.
    // Reject before decoding; an escaped backslash is a literal, not a Unicode escape.
    static func hasUnpairedSurrogateEscape(_ json: String) -> Bool {
        let b = Array(json.utf8)
        func hex(_ i: Int) -> UInt16? {
            guard i + 4 <= b.count else { return nil }
            var value: UInt16 = 0
            for byte in b[i..<(i+4)] {
                let n: UInt16
                switch byte {
                case 48...57: n = UInt16(byte - 48)
                case 65...70: n = UInt16(byte - 55)
                case 97...102: n = UInt16(byte - 87)
                default: return nil
                }
                value = value * 16 + n
            }
            return value
        }
        var i = 0
        while i + 1 < b.count {
            if b[i] != 92 { i += 1; continue }
            if b[i+1] != 117 { i += 2; continue }
            guard let value = hex(i + 2) else { i += 2; continue }
            if (0xd800...0xdbff).contains(value) {
                guard i + 12 <= b.count, b[i+6] == 92, b[i+7] == 117,
                      let low = hex(i+8), (0xdc00...0xdfff).contains(low) else { return true }
                i += 12
            } else if (0xdc00...0xdfff).contains(value) { return true }
            else { i += 6 }
        }
        return false
    }
    static func json(_ value: Any) throws -> String {
        do {
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed, .withoutEscapingSlashes])
            guard let string = String(data: data, encoding: .utf8) else { throw RepositoryError("CORRUPT") }
            return string
        } catch { throw RepositoryError("CORRUPT") }
    }
    // App timestamps are ISO-8601. Also handle ECMAScript's standard date-only
    // forms and local datetimes. Invalid stored dates rank as zero.
    static func time(_ value: String) -> Int64? {
        var text = value
        if let fraction = text.range(of: #"\.[0-9]+"#, options: .regularExpression) {
            let digits = String(text[fraction].dropFirst())
            text.replaceSubrange(fraction, with: "." + String((digits + "000").prefix(3)))
        }
        if text.count == 4, text.utf8.allSatisfy({ (48...57).contains($0) }) { text += "-01-01" }
        if text.count == 7, text[text.index(text.startIndex, offsetBy: 4)] == "-" { text += "-01" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: text)
        if date == nil { formatter.formatOptions = [.withInternetDateTime]; date = formatter.date(from: text) }
        if date == nil, text.count == 10 {
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.formatOptions = [.withFullDate]
            date = formatter.date(from: text)
        }
        if date == nil {
            let local = DateFormatter()
            local.locale = Locale(identifier: "en_US_POSIX")
            local.calendar = Calendar(identifier: .gregorian)
            local.timeZone = .current
            local.isLenient = false
            for format in ["yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm:ss", "MM/dd/yyyy"] {
                local.dateFormat = format
                if let d = local.date(from: text) { date = d; break }
            }
        }
        guard let d = date else { return nil }
        let ms = (d.timeIntervalSince1970 * 1000).rounded()
        guard ms.isFinite, abs(ms) <= 8640000000000000 else { return nil }
        return Int64(ms)
    }
}
