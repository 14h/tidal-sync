import AppKit

let folder = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                                      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                      isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let context = NSGraphicsContext.current!.cgContext
        context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
        let background = NSBezierPath(roundedRect: NSRect(x: 42, y: 42, width: 940, height: 940), xRadius: 215, yRadius: 215)
        NSGradient(starting: NSColor(red: 0.06, green: 0.25, blue: 0.30, alpha: 1), ending: NSColor(red: 0.02, green: 0.55, blue: 0.53, alpha: 1))!.draw(in: background, angle: 50)
        let config = NSImage.SymbolConfiguration(pointSize: 510, weight: .medium)
            .applying(NSImage.SymbolConfiguration(paletteColors: [.white]))
        NSImage(systemSymbolName: "music.note.list", accessibilityDescription: nil)!.withSymbolConfiguration(config)!
            .draw(in: NSRect(x: 220, y: 260, width: 580, height: 530))
        NSColor(red: 0.5, green: 0.94, blue: 0.8, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: 635, y: 130, width: 235, height: 235)).fill()
        let arrowConfig = NSImage.SymbolConfiguration(pointSize: 130, weight: .bold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [NSColor(red: 0.03, green: 0.26, blue: 0.29, alpha: 1)]))
        NSImage(systemSymbolName: "arrow.down", accessibilityDescription: nil)!.withSymbolConfiguration(arrowConfig)!
            .draw(in: NSRect(x: 695, y: 182, width: 115, height: 130))
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to: folder.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
