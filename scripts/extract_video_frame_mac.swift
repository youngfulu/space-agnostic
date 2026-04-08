#!/usr/bin/swift
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count >= 3 else {
    fputs("usage: extract_video_frame_mac.swift <video> <out.jpg>\n", stderr)
    exit(1)
}
let srcURL = URL(fileURLWithPath: CommandLine.arguments[1])
let dstURL = URL(fileURLWithPath: CommandLine.arguments[2])

let asset = AVAsset(url: srcURL)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
let dur = CMTimeGetSeconds(asset.duration)
let sec = (dur.isFinite && dur > 0) ? max(0.1, dur * 0.25) : 1.0
let t = CMTime(seconds: sec, preferredTimescale: 600)
do {
    let cg = try gen.copyCGImage(at: t, actualTime: nil)
    guard let dest = CGImageDestinationCreateWithURL(
        dstURL as CFURL,
        UTType.jpeg.identifier as CFString,
        1,
        nil
    ) else {
        exit(2)
    }
    let props = [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary
    CGImageDestinationAddImage(dest, cg, props)
    if !CGImageDestinationFinalize(dest) {
        exit(2)
    }
} catch {
    fputs("\(error)\n", stderr)
    exit(3)
}
