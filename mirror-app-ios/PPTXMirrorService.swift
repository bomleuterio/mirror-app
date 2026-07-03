import Foundation

enum PPTXMirrorError: LocalizedError {
    case serverError(String)
    case noData
    case badResponse(Int)

    var errorDescription: String? {
        switch self {
        case .serverError(let msg): return "Server error: \(msg)"
        case .noData:              return "No data returned from server."
        case .badResponse(let c):  return "Unexpected server response (\(c))."
        }
    }
}

struct PPTXMirrorService {
    // Update this to your deployed Render URL (or keep empty to auto-detect on device)
    private static let serverBase = "https://blvd365.onrender.com"

    static func mirror(fileURL: URL) async throws -> URL {
        guard let endpoint = URL(string: "\(serverBase)/api/mirror") else {
            throw PPTXMirrorError.serverError("Invalid server URL.")
        }

        let needsSecurity = fileURL.startAccessingSecurityScopedResource()
        defer { if needsSecurity { fileURL.stopAccessingSecurityScopedResource() } }

        let fileData = try Data(contentsOf: fileURL)

        let boundary = UUID().uuidString
        var request = URLRequest(url: endpoint, timeoutInterval: 120)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = buildMultipartBody(
            fileData: fileData,
            fileName: fileURL.lastPathComponent,
            boundary: boundary
        )

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else { throw PPTXMirrorError.noData }
        guard http.statusCode == 200 else {
            let msg = String(data: data, encoding: .utf8) ?? ""
            if http.statusCode == 400 || http.statusCode == 500 {
                throw PPTXMirrorError.serverError(msg.isEmpty ? "Unknown" : msg)
            }
            throw PPTXMirrorError.badResponse(http.statusCode)
        }
        guard !data.isEmpty else { throw PPTXMirrorError.noData }

        let outName = "mirrored_" + fileURL.deletingPathExtension().lastPathComponent + ".pptx"
        let outURL = FileManager.default.temporaryDirectory.appendingPathComponent(outName)
        try? FileManager.default.removeItem(at: outURL)
        try data.write(to: outURL)
        return outURL
    }

    private static func buildMultipartBody(fileData: Data, fileName: String, boundary: String) -> Data {
        var body = Data()

        func append(_ string: String) {
            if let d = string.data(using: .utf8) { body.append(d) }
        }

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"mode\"\r\n\r\n")
        append("pptx\r\n")

        append("--\(boundary)\r\n")
        let mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n")
        append("Content-Type: \(mime)\r\n\r\n")
        body.append(fileData)
        append("\r\n")

        append("--\(boundary)--\r\n")
        return body
    }
}
