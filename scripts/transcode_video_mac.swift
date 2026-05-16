#!/usr/bin/swift
import AVFoundation

// usage: transcode_video_mac.swift <in> <out.mp4> [maxSeconds]
guard CommandLine.arguments.count >= 3 else {
    fputs("usage: transcode_video_mac.swift <in> <out.mp4> [maxSeconds]\n", stderr)
    exit(1)
}

let srcURL = URL(fileURLWithPath: CommandLine.arguments[1])
let dstURL = URL(fileURLWithPath: CommandLine.arguments[2])
let maxSeconds: Double? = CommandLine.arguments.count >= 4 ? Double(CommandLine.arguments[3]) : nil

let asset = AVAsset(url: srcURL)

guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetMediumQuality) else {
    fputs("cannot create export session\n", stderr)
    exit(2)
}

// Best-effort time range trim (keeps it light for GIF sources)
if let maxS = maxSeconds, maxS > 0 {
    let dur = CMTimeGetSeconds(asset.duration)
    if dur.isFinite && dur > 0 {
        let end = min(dur, maxS)
        export.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: end, preferredTimescale: 600))
    }
}

export.outputURL = dstURL
export.outputFileType = .mp4
export.shouldOptimizeForNetworkUse = true

// Overwrite if exists
try? FileManager.default.removeItem(at: dstURL)

let sem = DispatchSemaphore(value: 0)
export.exportAsynchronously {
    sem.signal()
}
_ = sem.wait(timeout: .distantFuture)

switch export.status {
case .completed:
    exit(0)
case .failed:
    if let err = export.error { fputs("\(err)\n", stderr) }
    exit(3)
case .cancelled:
    fputs("cancelled\n", stderr)
    exit(4)
default:
    if let err = export.error { fputs("\(err)\n", stderr) }
    exit(5)
}

