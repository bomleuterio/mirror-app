import SwiftUI
import UniformTypeIdentifiers

enum MirrorMode: String, CaseIterable {
    case pdf = "PDF"
    case pptx = "PPTX"

    var contentTypes: [UTType] {
        switch self {
        case .pdf:
            return [.pdf]
        case .pptx:
            return [UTType(filenameExtension: "pptx") ?? .data]
        }
    }
}

struct ContentView: View {
    @State private var mode: MirrorMode = .pdf
    @State private var isPicking = false
    @State private var pickedURL: URL?
    @State private var outputURL: URL?
    @State private var status: String = ""
    @State private var isWorking = false

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                Picker("Mode", selection: $mode) {
                    ForEach(MirrorMode.allCases, id: \.self) { m in
                        Text(m.rawValue).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .onChange(of: mode) { _ in
                    pickedURL = nil
                    outputURL = nil
                    status = ""
                }

                VStack(spacing: 10) {
                    Button {
                        isPicking = true
                    } label: {
                        Label("Choose \(mode.rawValue) File", systemImage: "doc.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)

                    if let pickedURL {
                        Label(pickedURL.lastPathComponent, systemImage: "doc.text")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal)

                Button {
                    guard let pickedURL else { return }
                    Task { await mirror(url: pickedURL) }
                } label: {
                    if isWorking {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Mirror \(mode.rawValue)")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.indigo)
                .disabled(pickedURL == nil || isWorking)
                .padding(.horizontal)

                if let outputURL {
                    ShareLink(
                        item: outputURL,
                        subject: Text("Mirrored \(mode.rawValue)"),
                        message: Text("Here is the mirrored \(mode.rawValue) file.")
                    ) {
                        Label("Share Mirrored File", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .padding(.horizontal)
                }

                if !status.isEmpty {
                    Text(status)
                        .font(.footnote)
                        .foregroundStyle(status.hasPrefix("Error") ? Color.red : Color.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                }

                Spacer()

                if mode == .pptx {
                    Text("PPTX mirroring is processed on the server — an internet connection is required.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding([.horizontal, .bottom])
                }
            }
            .padding(.top)
            .navigationTitle("Mirror App")
            .sheet(isPresented: $isPicking) {
                DocumentPicker(allowedContentTypes: mode.contentTypes) { url in
                    pickedURL = url
                    outputURL = nil
                    status = ""
                }
            }
        }
        .navigationViewStyle(.stack)
    }

    @MainActor
    private func mirror(url: URL) async {
        guard !isWorking else { return }
        isWorking = true
        status = "Mirroring…"
        outputURL = nil
        defer { isWorking = false }

        do {
            switch mode {
            case .pdf:
                outputURL = try PDFMirror.mirror(inputURL: url)
            case .pptx:
                outputURL = try await PPTXMirrorService.mirror(fileURL: url)
            }
            status = "Done."
        } catch {
            status = "Error: \(error.localizedDescription)"
        }
    }
}
