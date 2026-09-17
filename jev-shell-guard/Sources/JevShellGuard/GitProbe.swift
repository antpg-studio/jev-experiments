import Foundation

/// Cheap git facts: branch from `.git/HEAD` (no subprocess), dirtiness from one bounded
/// `git status` call so a slow repo can never hold the shell hostage.
public enum GitProbe {
  public static let defaultBranches: Set<String> = ["main", "master", "trunk", "develop"]

  public static func repoRoot(from cwd: String) -> String? {
    var dir = (cwd as NSString).standardizingPath
    while true {
      if FileManager.default.fileExists(atPath: dir + "/.git") { return dir }
      if dir == "/" || dir.isEmpty { return nil }
      dir = (dir as NSString).deletingLastPathComponent
    }
  }

  public static func branch(repoRoot: String) -> String? {
    var gitDir = repoRoot + "/.git"
    var isDir: ObjCBool = false
    FileManager.default.fileExists(atPath: gitDir, isDirectory: &isDir)
    if !isDir.boolValue, let text = try? String(contentsOfFile: gitDir, encoding: .utf8),
      text.hasPrefix("gitdir: ")
    {
      let rel = text.dropFirst("gitdir: ".count).trimmingCharacters(in: .whitespacesAndNewlines)
      gitDir = rel.hasPrefix("/") ? rel : (repoRoot + "/" + rel as NSString).standardizingPath
    }
    guard let head = try? String(contentsOfFile: gitDir + "/HEAD", encoding: .utf8) else {
      return nil
    }
    return parseHead(head)
  }

  public static func parseHead(_ head: String) -> String {
    let line = head.trimmingCharacters(in: .whitespacesAndNewlines)
    if line.hasPrefix("ref: refs/heads/") {
      return String(line.dropFirst("ref: refs/heads/".count))
    }
    return "detached@" + String(line.prefix(8))
  }

  public static func isDirty(repoRoot: String, timeoutMs: Int) -> Bool? {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    proc.arguments = ["git", "-C", repoRoot, "status", "--porcelain", "--untracked-files=no"]
    let pipe = Pipe()
    proc.standardOutput = pipe
    proc.standardError = FileHandle.nullDevice
    do { try proc.run() } catch { return nil }
    let deadline = DispatchTime.now() + .milliseconds(timeoutMs)
    let group = DispatchGroup()
    group.enter()
    proc.terminationHandler = { _ in group.leave() }
    var output = Data()
    let reader = DispatchQueue(label: "jevsh.git")
    reader.async { output = pipe.fileHandleForReading.readDataToEndOfFile() }
    if group.wait(timeout: deadline) == .timedOut {
      proc.terminate()
      return nil
    }
    reader.sync {}
    guard proc.terminationStatus == 0 else { return nil }
    return !output.isEmpty
  }

  public static func probe(cwd: String, timeoutMs: Int = 120) -> CommandState.Git {
    guard let root = repoRoot(from: cwd) else {
      return .init(inRepo: false, branch: nil, workingTreeDirty: nil, onDefaultBranch: false)
    }
    let b = branch(repoRoot: root)
    return .init(
      inRepo: true,
      branch: b,
      workingTreeDirty: isDirty(repoRoot: root, timeoutMs: timeoutMs),
      onDefaultBranch: b.map { defaultBranches.contains($0) } ?? false
    )
  }
}
