//
//  SafariWebExtensionHandler.swift
//  lil download Safari Extension
//
//  Принимает ссылки от кнопки в Сафари и кладёт их в «почтовый ящик»
//  lil download (PLAN.md §13): JSON-файл в папку inbox, потом стук
//  ссылкой lildownload://inbox. Программа, если закрыта, откроется сама.
//

import AppKit
import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]

        func reply(_ body: [String: Any]) {
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: body]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }

        switch message["action"] as? String {
        case "send":
            let raw = message["items"] as? [[String: Any]] ?? []
            let items: [[String: Any]] = raw.compactMap { item in
                guard let url = item["url"] as? String, Self.isWeb(url) else { return nil }
                var out: [String: Any] = ["url": url]
                if let r = item["referer"] as? String, Self.isWeb(r) { out["referer"] = r }
                if let k = item["kind"] as? String, k == "video" || k == "file" { out["kind"] = k }
                return out
            }
            guard !items.isEmpty else { return reply(["error": "Нечего отправлять"]) }
            do {
                try Self.post(items)
            } catch {
                return reply(["error": "Не положить ссылку для lil download: \(error.localizedDescription)"])
            }
            guard let knock = URL(string: "lildownload://inbox"), NSWorkspace.shared.open(knock) else {
                return reply(["error": "lil download не установлен — поставь его с GitHub"])
            }
            reply(["ok": true])

        default:
            reply(["error": "Неизвестная команда"])
        }
    }

    private static func isWeb(_ s: String) -> Bool {
        s.hasPrefix("http://") || s.hasPrefix("https://")
    }

    /// Настоящая домашняя папка, а не папка песочницы расширения.
    private static var realHome: URL {
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
            return URL(fileURLWithPath: String(cString: dir), isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
    }

    /// Пишем под временным именем и переименовываем: lil download читает только
    /// файлы на .json, поэтому недописанный файл он не увидит.
    private static func post(_ items: [[String: Any]]) throws {
        let dir = realHome.appendingPathComponent("Library/Application Support/com.lil.download/inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8))"
        let tmp = dir.appendingPathComponent("\(name).json.tmp")
        let final = dir.appendingPathComponent("\(name).json")
        let data = try JSONSerialization.data(withJSONObject: items)
        try data.write(to: tmp)
        try FileManager.default.moveItem(at: tmp, to: final)
    }
}
