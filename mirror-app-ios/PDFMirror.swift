import Foundation
import CoreGraphics

enum PDFMirrorError: LocalizedError {
    case openFailed
    case noPages
    case outputCreateFailed

    var errorDescription: String? {
        switch self {
        case .openFailed:
            return "Could not open PDF."
        case .noPages:
            return "PDF has no pages."
        case .outputCreateFailed:
            return "Could not create output PDF."
        }
    }
}

struct PDFMirror {
    static func mirror(inputURL: URL) throws -> URL {
        guard let doc = CGPDFDocument(inputURL as CFURL) else {
            throw PDFMirrorError.openFailed
        }

        let pageCount = doc.numberOfPages
        guard pageCount > 0 else {
            throw PDFMirrorError.noPages
        }

        let inputBase = inputURL.deletingPathExtension().lastPathComponent
        let outURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("mirrored_\(inputBase).pdf")

        try? FileManager.default.removeItem(at: outURL)

        guard let consumer = CGDataConsumer(url: outURL as CFURL) else {
            throw PDFMirrorError.outputCreateFailed
        }

        var firstBox = CGRect(x: 0, y: 0, width: 612, height: 792)
        if let firstPage = doc.page(at: 1) {
            firstBox = firstPage.getBoxRect(.mediaBox)
        }

        var mediaBox = firstBox
        guard let ctx = CGContext(consumer: consumer, mediaBox: &mediaBox, nil) else {
            throw PDFMirrorError.outputCreateFailed
        }

        for i in 1...pageCount {
            guard let page = doc.page(at: i) else { continue }
            let box = page.getBoxRect(.mediaBox)
            let info = [kCGPDFContextMediaBox as String: box] as CFDictionary
            ctx.beginPDFPage(info)

            ctx.saveGState()
            ctx.translateBy(x: box.width, y: 0)
            ctx.scaleBy(x: -1, y: 1)
            ctx.drawPDFPage(page)
            ctx.restoreGState()

            ctx.endPDFPage()
        }

        ctx.closePDF()
        return outURL
    }
}
