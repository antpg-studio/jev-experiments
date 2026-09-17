import Foundation

/// The five judgments asked of Jev in a single fan-out request.
public enum Questions {
  public static let destructive = "destructive"
  public static let wrongTarget = "wrong_target"
  public static let likelyTypo = "likely_typo"
  public static let leaksSecret = "leaks_secret"
  public static let verdict = "verdict"

  public static let noulIDs = [destructive, wrongTarget, likelyTypo, leaksSecret]

  public static func request(state: CommandState) -> [String: Any] {
    [
      "model": "jev-latest",
      "state": (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(state))) ?? [:],
      "questions": [
        destructive: [
          "type": "noul",
          "instructions":
            "Will running `command` irreversibly destroy data a developer would care about losing? "
            + "Consider `git.working_tree_dirty` and `git.branch` for git commands and "
            + "`referenced_paths` for file commands.",
          "criteria": [
            "true":
              "Deletes or overwrites source files, documents or user data; discards uncommitted "
              + "changes; rewrites or force-pushes shared git history; drops databases; wipes disks.",
            "false":
              "Read-only or additive; changes are easy to undo; or it only removes regenerable "
              + "artifacts such as build output, caches, node_modules, dist or temp files.",
          ],
        ],
        wrongTarget: [
          "type": "noul",
          "instructions":
            "Given `cwd`, `git` and `referenced_paths`, does `command` aim at the wrong or an "
            + "unusually dangerous target: the home directory, the filesystem root, a system path, "
            + "a protected branch such as main or master, a production host or database, or a "
            + "path that does not exist?",
          "criteria": [
            "true":
              "A destructive or mutating operation pointed at `~`, `/`, a system directory, a "
              + "path with `exists: false`, or a prod/production host; or a history-rewriting git "
              + "operation (force push, reset --hard, branch -D, rebase of pushed commits) while "
              + "`git.branch` is main/master.",
            "false":
              "Targets look like the developer's own project files in or under `cwd`, a feature "
              + "branch, or local/dev hosts; an ordinary commit, push, pull or fetch even on main; "
              + "or the command does not mutate anything.",
          ],
        ],
        likelyTypo: [
          "type": "noul",
          "instructions":
            "Does `command` contain a misspelled program name or flag, so that it will simply "
            + "fail with an error instead of doing what was meant? `tool.found_in_path` says "
            + "whether the program exists on this machine.",
          "criteria": [
            "true":
              "`tool.name` is a transposition or misspelling of a real tool (gti, sl, pytohn, "
              + "dokcer), or a flag is clearly misspelled (--forse, -lsa).",
            "false":
              "The program and flags are spelled correctly. A correctly spelled tool that is "
              + "merely not installed (`found_in_path` false for docker, cargo, kubectl) is not "
              + "a typo.",
          ],
        ],
        leaksSecret: [
          "type": "noul",
          "instructions":
            "Does `command` inline a literal credential such as an API key, bearer token, "
            + "password or private key that will be written to shell history?",
          "criteria": [
            "true":
              "A literal secret value appears in the command text (sk-..., ghp_..., AKIA..., "
              + "Bearer <token>, password=<value>, user:password@host).",
            "false":
              "No secret, or it is read from an environment variable, file or prompt "
              + "(e.g. $TOKEN, --password-file, -p with no value).",
          ],
        ],
        verdict: [
          "type": "choice",
          "instructions":
            "Should the shell run `command` immediately, ask the developer to confirm first, or "
            + "refuse to run it?",
          "criteria": [
            "run": "Ordinary, safe or easily reversible command; the developer clearly meant it.",
            "confirm":
              "Risky, irreversible, typo-like or secret-leaking, but plausibly intended; a "
              + "one-line confirmation is warranted.",
            "block":
              "Almost certainly catastrophic or a mistake: deleting the home directory or the "
              + "filesystem root, wiping a disk, forking-bombing the shell.",
          ],
        ],
      ],
    ]
  }
}
