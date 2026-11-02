import SwiftUI
import AppKit

struct Playlist: Identifiable, Decodable {
    let id: String
    let title: String
    let count: Int
}

struct Song: Identifiable, Decodable {
    let id: String
    let trackId: Int
    let title: String
    let artist: String
    let album: String
    let duration: Int
    let playlistId: String
    let playlistTitle: String
    let downloaded: Bool

    var time: String { String(format: "%d:%02d", duration / 60, duration % 60) }
}

struct BridgeEvent: Decodable {
    let type: String
    var message: String?
    var url: String?
    var code: String?
    var playlists: [Playlist]?
    var playlist: Playlist?
    var songs: [Song]?
    var downloaded: Int?
    var failed: Int?
    var completed: Int?
    var total: Int?
    var query: String?
}

@MainActor
final class AppModel: ObservableObject {
    @Published var playlists: [Playlist] = []
    @Published var selected = Set<String>()
    @Published var songs: [Song] = []
    @Published var excludedSongs = Set<String>()
    @Published var downloading = false
    @Published var activeSearch = ""
    private var pendingTracks = false
    private var downloadSummary: String?

    var chosenSongs: [Song] { songs.filter { !$0.downloaded && !excludedSongs.contains($0.id) } }

    func search(_ query: String) {
        guard !downloading else { return }
        activeSearch = query.trimmingCharacters(in: .whitespacesAndNewlines)
        excludedSongs = []
        loadSongs()
    }

    func loadSongs() {
        songs = []
        if busy { pendingTracks = true; return }
        pendingTracks = false
        if !activeSearch.isEmpty {
            run("search", arguments: [activeSearch, folder])
            return
        }
        guard !selected.isEmpty else { return }
        run("tracks", arguments: [folder] + selected.sorted())
    }

    func startDownload() {
        let grouped = Dictionary(grouping: chosenSongs.filter { !$0.playlistId.isEmpty }, by: \.playlistId)
        let directIds = chosenSongs.filter { $0.playlistId.isEmpty }.map(\.trackId)
        let entries: [[String: Any]] = grouped.keys.sorted().map { id in
            ["id": id, "trackIds": grouped[id]!.map(\.trackId)]
        }
        guard !entries.isEmpty || !directIds.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: ["folder": folder, "playlists": entries, "trackIds": directIds]) else { return }
        run("download", payload: data)
    }

    func setSong(_ song: Song, selected: Bool) {
        if selected { excludedSongs.remove(song.id) } else { excludedSongs.insert(song.id) }
    }

    func selectAllSongs(_ selected: Bool) {
        for song in songs where !song.downloaded { setSong(song, selected: selected) }
    }
    @Published var signedIn = false
    @Published var busy = false
    @Published var status = "Ready"
    @Published var log = ""
    @Published var error: String?
    @Published var authorizationURL: URL?
    @Published var authorizationCode = ""
    @Published var completed = 0
    @Published var total = 0
    @Published var playlistURL = ""
    @Published var folder: String = UserDefaults.standard.string(forKey: "downloadFolder")
        ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Music/Tidal Sync").path
    private var process: Process?
    private var reader: Task<Void, Never>?

    func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Choose Download Folder"
        if panel.runModal() == .OK, let url = panel.url {
            folder = url.path
            UserDefaults.standard.set(folder, forKey: "downloadFolder")
        }
    }

    func run(_ command: String, arguments: [String] = [], payload: Data? = nil) {
        guard !busy else { return }
        guard let resources = Bundle.main.resourceURL else { return }
        let node = resources.appendingPathComponent("runtime/node")
        let bridge = resources.appendingPathComponent("backend/dist/desktop.js")
        guard FileManager.default.isExecutableFile(atPath: node.path),
              FileManager.default.fileExists(atPath: bridge.path) else {
            error = "App resources are missing. Build the app with npm run build:macos."
            return
        }
        error = nil
        authorizationURL = nil
        busy = true
        let downloading = ["sync", "url", "download"].contains(command)
        self.downloading = downloading
        status = downloading ? "Downloading…" : (command == "search" ? "Searching Tidal…" : (command == "tracks" ? "Loading songs…" : "Connecting…"))
        if downloading { log = ""; completed = 0; total = 0; downloadSummary = nil }
        let child = Process()
        child.executableURL = node
        child.arguments = [bridge.path, command] + arguments
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (environment["PATH"] ?? "")
        environment["NO_COLOR"] = "1"
        child.environment = environment
        let pipe = Pipe()
        child.standardOutput = pipe
        child.standardError = pipe
        let inputPipe = payload == nil ? nil : Pipe()
        if let inputPipe { child.standardInput = inputPipe }
        else { child.standardInput = FileHandle.nullDevice }
        process = child
        do {
            try child.run()
            if let payload, let inputPipe {
                Task.detached {
                    try? inputPipe.fileHandleForWriting.write(contentsOf: payload)
                    try? inputPipe.fileHandleForWriting.close()
                }
            }
        } catch {
            self.error = error.localizedDescription
            busy = false
            self.downloading = false
            process = nil
            return
        }
        reader = Task { [weak self] in
            do {
                for try await line in pipe.fileHandleForReading.bytes.lines {
                    guard let self else { return }
                    if let event = try? JSONDecoder().decode(BridgeEvent.self, from: Data(line.utf8)) {
                        self.receive(event)
                    } else if !line.trimmingCharacters(in: .whitespaces).isEmpty {
                        self.appendLog(line)
                    }
                }
            } catch {
                self?.error = error.localizedDescription
            }
            guard let self else { return }
            child.waitUntilExit()
            if self.status == "Stopping…" {
                self.status = "Stopped"
            } else if child.terminationStatus != 0 {
                self.status = "Failed"
                if self.error == nil { self.error = "The download engine exited unexpectedly. See the activity log." }
            } else {
                self.status = self.downloadSummary ?? (downloading ? "Finished" : "Ready")
            }
            self.downloading = false
            self.busy = false
            self.authorizationURL = nil
            self.process = nil
            self.reader = nil
            if self.pendingTracks { self.loadSongs() }
            else if downloading && child.terminationStatus == 0 && self.status != "Stopped" {
                self.loadSongs()
            }
        }
    }

    private func receive(_ event: BridgeEvent) {
        switch event.type {
        case "authenticated": signedIn = true
        case "signedOut":
            signedIn = false
            playlists = []
            selected = []
            songs = []
            excludedSongs = []
            activeSearch = ""
        case "playlists":
            playlists = event.playlists ?? []
            selected.formIntersection(Set(playlists.map(\.id)))
        case "playlistAdded":
            if let playlist = event.playlist {
                playlists.removeAll { $0.id == playlist.id }
                playlists.append(playlist)
                playlists.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
                selected.insert(playlist.id)
                activeSearch = ""
                playlistURL = ""
                pendingTracks = true
            }
        case "songs":
            if !pendingTracks && (event.query ?? "") == activeSearch {
                songs = event.songs ?? []
                if event.query != nil {
                    // Search results are opt-in; don't download the whole result set by default.
                    excludedSongs.formUnion(songs.map(\.id))
                }
            }
        case "summary":
            downloadSummary = "\(event.downloaded ?? 0) downloaded · \(event.failed ?? 0) failed"
        case "authorization":
            authorizationCode = event.code ?? ""
            authorizationURL = event.url.flatMap { value in
                let raw = value.trimmingCharacters(in: .whitespacesAndNewlines)
                let absolute = raw.hasPrefix("//") ? "https:" + raw
                    : (raw.contains("://") ? raw : "https://" + raw)
                guard let url = URL(string: absolute),
                      let scheme = url.scheme?.lowercased(),
                      ["https", "http"].contains(scheme), url.host != nil else { return nil }
                return url
            }
            status = "Finish signing in in your browser"
            openTidalLogin()
        case "log": appendLog(event.message ?? "")
        case "progress":
            completed = event.completed ?? 0
            total = event.total ?? 0
        case "failure": error = event.message ?? "Something went wrong."
        default: break
        }
    }

    private func appendLog(_ message: String) {
        log += message + "\n"
        if log.count > 100_000 { log = String(log.suffix(80_000)) }
    }

    func openTidalLogin() {
        guard let url = authorizationURL else {
            error = "Tidal returned an invalid login URL. Please try signing in again."
            return
        }
        // Let macOS choose the user's default browser for this HTTPS URL.
        if !NSWorkspace.shared.open(url) {
            error = "Couldn’t open your default browser. Open \(url.absoluteString) in your browser and enter the sign-in code."
        }
    }

    func stop() {
        guard let process, process.isRunning else { return }
        status = "Stopping…"
        process.terminate()
    }
}

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var playlistSearch = ""
    @State private var songSearch = ""
    @State private var showActivity = false

    private var filteredPlaylists: [Playlist] {
        model.playlists.filter { playlistSearch.isEmpty || $0.title.localizedCaseInsensitiveContains(playlistSearch) }
    }

    var body: some View {
        HSplitView {
            sidebar
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(model.activeSearch.isEmpty ? "Songs" : "Tidal Search").font(.title2.bold())
                        Text(model.activeSearch.isEmpty ? "\(model.selected.count) playlists · \(model.songs.count) songs" : "\(model.songs.count) results")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    HStack(spacing: 6) {
                        TextField("Search Tidal", text: $songSearch)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { model.search(songSearch) }
                        Button { model.search(songSearch) } label: { Image(systemName: "magnifyingglass") }
                            .help("Search Tidal").disabled(songSearch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        if !model.activeSearch.isEmpty {
                            Button { songSearch = ""; model.search("") } label: { Image(systemName: "xmark.circle.fill") }
                                .help("Back to playlists")
                        }
                    }.frame(maxWidth: 300).disabled(model.downloading)
                }.padding(20)
                HStack(spacing: 16) {
                    Button("Select All") { model.selectAllSongs(true) }
                    Button("Deselect All") { model.selectAllSongs(false) }
                    Spacer()
                    Text("\(model.chosenSongs.count) selected").foregroundStyle(.secondary)
                }.font(.callout).padding(.horizontal, 20).padding(.bottom, 12)
                    .disabled(model.busy || model.songs.isEmpty)
                Divider()
                Table(model.songs) {
                    TableColumn("") { song in
                        Toggle("Select \(song.title)", isOn: Binding(
                            get: { !song.downloaded && !model.excludedSongs.contains(song.id) },
                            set: { model.setSong(song, selected: $0) }
                        ))
                        .labelsHidden().toggleStyle(.checkbox)
                        .disabled(model.busy || song.downloaded)
                    }.width(24)
                    TableColumn("Title") { song in
                        HStack {
                            Text(song.title).lineLimit(1)
                            if song.downloaded {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(.secondary).help("Downloaded")
                            }
                        }
                    }.width(min: 150, ideal: 230)
                    TableColumn("Artist", value: \.artist).width(min: 100, ideal: 150)
                    TableColumn("Album", value: \.album).width(min: 100, ideal: 150)
                    TableColumn("Playlist", value: \.playlistTitle).width(min: 100, ideal: 140)
                    TableColumn("Time") { Text($0.time).monospacedDigit().foregroundStyle(.secondary) }.width(45)
                }
                .overlay {
                    if model.songs.isEmpty {
                        VStack(spacing: 10) {
                            if model.busy { ProgressView().controlSize(.small) }
                            Text(model.busy ? model.status : (model.activeSearch.isEmpty ? "Select playlists" : "No results"))
                                .foregroundStyle(.secondary)
                        }.allowsHitTesting(false)
                    }
                }
                if let _ = model.authorizationURL {
                    Divider()
                    HStack {
                        Text("Code: \(model.authorizationCode)").textSelection(.enabled)
                        Button("Open Tidal Login") { model.openTidalLogin() }
                        Spacer()
                    }.padding(12)
                }
                if showActivity {
                    Divider()
                    ScrollView {
                        Text(model.log).font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    }.frame(height: 130)
                }
                Divider()
                downloadBar
            }.frame(minWidth: 700, maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(minWidth: 980, minHeight: 640)
        .alert("Tidal Sync", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .task { model.run("status") }
        .onChange(of: model.selected) { _ in songSearch = ""; model.search("") }
        .onChange(of: model.folder) { _ in model.loadSongs() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in model.stop() }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Playlists").font(.headline)
                Spacer()
                Button { model.run(model.signedIn ? "list" : "login") } label: {
                    Image(systemName: model.signedIn ? "arrow.clockwise" : "person.crop.circle")
                }.buttonStyle(.borderless).disabled(model.busy)
                    .help(model.signedIn ? "Refresh" : "Sign In")
            }.padding(16)
            TextField("Search playlists", text: $playlistSearch)
                .textFieldStyle(.roundedBorder).padding(.horizontal, 12).padding(.bottom, 8)
            List(filteredPlaylists, selection: $model.selected) { playlist in
                HStack(spacing: 10) {
                    Image(systemName: "music.note.list").foregroundStyle(.teal)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(playlist.title).lineLimit(2)
                        Text("\(playlist.count) songs").font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(.vertical, 4).tag(playlist.id)
            }.listStyle(.sidebar).disabled(model.downloading)
            Divider()
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    TextField("Playlist link", text: $model.playlistURL).textFieldStyle(.roundedBorder)
                        .onSubmit { addPlaylist() }
                    Button { addPlaylist() } label: { Image(systemName: "plus") }
                        .help("Add to Tidal library")
                        .disabled(model.playlistURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }.disabled(model.busy)
                HStack {
                    Circle().fill(model.signedIn ? .green : .secondary).frame(width: 6, height: 6)
                    Text(model.signedIn ? "Tidal" : "Signed out").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button(model.signedIn ? "Sign Out" : "Sign In") {
                        model.run(model.signedIn ? "logout" : "login")
                    }.font(.caption).buttonStyle(.borderless).disabled(model.busy)
                }
            }.padding(12)
        }
        .frame(minWidth: 240, idealWidth: 270, maxWidth: 340, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var downloadBar: some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                Button { model.chooseFolder() } label: {
                    Label(model.folder, systemImage: "folder").lineLimit(1).truncationMode(.middle)
                }.buttonStyle(.borderless).help(model.folder).disabled(model.busy)
                Spacer()
                Button { showActivity.toggle() } label: { Image(systemName: "list.bullet.rectangle") }
                    .buttonStyle(.borderless).help("Activity")
            }.font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(model.status).lineLimit(1)
                        Spacer()
                        if model.total > 0 {
                            Text("\(model.completed) / \(model.total)").monospacedDigit()
                        }
                    }.font(.caption).foregroundStyle(.secondary)
                    ProgressView(value: Double(model.completed), total: Double(max(1, model.total)))
                        .tint(.teal)
                }
                if model.downloading {
                    Button("Stop") { model.stop() }.controlSize(.large)
                } else {
                    Button("Download \(model.chosenSongs.count) Songs") { model.startDownload() }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                        .disabled(model.busy || model.chosenSongs.isEmpty)
                }
            }
        }.padding(16)
        .background(.bar)
    }

    private func addPlaylist() {
        let url = model.playlistURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !model.busy, !url.isEmpty else { return }
        model.run("add", arguments: [url])
    }
}

@main
struct TidalSyncApp: App {
    @StateObject private var model = AppModel()
    var body: some Scene {
        WindowGroup("Tidal Sync") { ContentView().environmentObject(model) }
            .windowStyle(.titleBar)
            .commands {
                CommandGroup(replacing: .newItem) {}
                CommandGroup(replacing: .appTermination) {
                    Button("Quit Tidal Sync") {
                        model.stop()
                        NSApplication.shared.terminate(nil)
                    }.keyboardShortcut("q")
                }
            }
    }
}
